/***************************************************************************
 * Copyright (C) 2015-2020 Excelero, Inc. All Rights Reserved.
 *
 * This file is part of Excelero NVMesh software.
 *
 * Unauthorized copying of this file, via any medium is strictly prohibited
 * Proprietary and confidential
 ****************************************************************************/

/* global app */

const uuid = require('uuid');
const async = require('async');

const consts = require('../consts.js');
const objectNotifier = require('../objectNotifier.js');
const events = require('../events.js');
const utils = require('../utils.js');
const systemMessages = require('../systemMessages.js');
const { Entities, SystemMessage, MongoError, SystemAdminMessage, Differentiators } = require('../modules/error.js');
const logger = require('../logger.js');
const kafkaModule = require('./kafka.js');
const upgradeModule = require('./upgrade.js');
const { UpdateUpgradeAgentKeepaliveToken } = require('../models/kafkaMessages/UpdateUpgradeAgentKeepaliveToken.js');
const eventsModule = require('../events.js');
const lastMessageLog = require('./lastMessageLog.js');

const scope = {};

scope.handleUpgradeAgentTimeout = (upgradeAgentID, cb) => {
	scope.setUpgradeAgentOffline(upgradeAgentID, cb);
};

scope.getUpgradeAgentHealth = (status, upgradeAgentInternalHealth) => {
	let health = consts.upgradeAgentHealth.HEALTHY;

	if (upgradeAgentInternalHealth && upgradeAgentInternalHealth === consts.upgradeAgentInternalHealth.CRITICAL) {
		health = consts.upgradeAgentHealth.CRITICAL;
	}

	if (!status || status === consts.upgradeAgentStatus.OFFLINE) {
		health = consts.upgradeAgentHealth.CRITICAL;
	}

	return health;
};

scope.setUpgradeAgentOffline = (upgradeAgentID, cb) => {
	const db = app.get('db');
	const upgradeAgentCollection = db.collection('upgradeAgent');

	const query = { _id: upgradeAgentID };

	const $set = {
		status: consts.upgradeAgentStatus.OFFLINE,
		health: scope.getUpgradeAgentHealth(consts.upgradeAgentStatus.OFFLINE),
	};

	// Zero all message sequence counters
	Object.values(consts.upgradeAgentKafkaMessageSeqTypes).forEach(t => $set['kafkaMessageSequence.' + t] = 0);

	upgradeAgentCollection.findOneAndUpdate(
		query,
		{
			$set: $set,
			$inc: {
				upgradeAgentToken: 1
			}
		},
		{ returnDocument: 'after' },
		function(err, updatedUpgradeAgent) {
			if (!err && updatedUpgradeAgent) {
				logger.sysDEBUG(`setUpgradeAgentOffline: ${upgradeAgentID} upgradeAgentToken updated from `
					+ `${updatedUpgradeAgent.upgradeAgentToken} to ${updatedUpgradeAgent.upgradeAgentToken + 1}`);

				eventsModule.emitEvent([eventsModule.getUpgradeAgentID(upgradeAgentID)], objectNotifier.events.upgradeAgentChangedEvent, updatedUpgradeAgent);
			}

			if (cb)
				cb();
		}
	);
};

scope.handleKeepAlive = (message, mainCallback) => {
	const db = app.get('db');
	const upgradeAgentCollection = db.collection('upgradeAgent');
	const GLOBAL_SETTINGS = app.get('globalSettings');
	const keepaliveInterval = GLOBAL_SETTINGS.keepaliveIntervals.UPGRADE_AGENT;
	let isUpgradeAgentExists = false;
	let newToken = 0;
	let dbUpgradeAgent;
	let currentTopics;
	let currentInteropDBVersion;
	let versionChanged;
	let shouldUpdateKeepaliveInterval = false;

	if (keepaliveInterval !== message.keepaliveInterval) {
		logger.sysDEBUG(
			`Unexpected UpgradeAgent ${message.upgradeAgentID} keepaliveInterval, configured: ${keepaliveInterval} actual: ${message.keepaliveInterval}`);
		shouldUpdateKeepaliveInterval = true;
	}

	const createUpgradeAgent = (message, callback) => {
		if (!message.payload.featureCompatibilityVersion)
			return callback(new SystemMessage(systemMessages.UPGRADE_AGENT_CREATE_FAILED)
				.addInfo(Entities.UpgradeAgent.ID, message.upgradeAgentID)
				.addInfo(Entities.UpgradeAgent.KeepAlive, message).log());

		kafkaModule.createUpgradeAgentTopics(message.upgradeAgentID, message.payload.featureCompatibilityVersion, (err, topics) => {
			if (err) return callback(err);

			currentTopics = topics;
			const newUpgradeAgent = {
				_id: message.upgradeAgentID,
				uuid: uuid.v1(),
				hostname: message.hostname,
				kafkaMessageSequence: { [message.type]: message.messageSequence },
				upgradeAgentToken: newToken,
				upgradeAgentData: message.payload,
				status: consts.upgradeAgentStatus.ONLINE,
				health: scope.getUpgradeAgentHealth(consts.upgradeAgentStatus.ONLINE, message.payload.health),
				topics: currentTopics
			};

			upgradeAgentCollection.insertOne(newUpgradeAgent,
				{ $currentDate: { dateModified: true, dateCreated: true, lastReceivedKeepAlive: true } }, (err) => {
					if (err) {
						const mongoError = new MongoError(err);

						if (mongoError.isDuplicateKeyError) {
							logger.sysDEBUG(`upgrade agent ${message.upgradeAgentID} already exists - message may have been handled by another management`);
							return callback();
						}

						return callback(mongoError);
					}

					callback(null, newUpgradeAgent);
				});
		});
	};

	const updateUpgradeAgent = (message, callback) => {
		const query = {
			_id: message.upgradeAgentID,
			$or: [
				{ upgradeAgentToken: { $exists: false } },
				{ upgradeAgentToken: message.upgradeAgentToken, [`kafkaMessageSequence.${message.type}`]: { $lt: message.messageSequence } }
			]
		};

		const $set = {
			[`kafkaMessageSequence.${message.type}`]: message.messageSequence,
			upgradeAgentData: message.payload,
			status: consts.upgradeAgentStatus.ONLINE,
			health: scope.getUpgradeAgentHealth(consts.upgradeAgentStatus.ONLINE, message.payload.health),
		};

		if (versionChanged)
			$set.topics = currentTopics;

		const update = {
			$set,
			$currentDate: { dateModified: true, lastReceivedKeepAlive: true }
		};

		upgradeAgentCollection.findOneAndUpdate(query, update, { returnDocument: 'after' }, (err, updatedUpgradeAgent) => {
			if (err) return callback(new MongoError(err).log());

			callback(null, updatedUpgradeAgent);
		});
	};

	async.series([
		function lookForExistingUpgradeAgent(callback) {
			const projection = {
				kafkaMessageSequence: 1,
				upgradeAgentToken: 1,
				topics: 1,
				'upgradeAgentData.featureCompatibilityVersion': 1,
				[`upgradeAgentData.nvmeshVersions.${consts.components.INTEROP_DB}`]: 1
			};

			upgradeAgentCollection.findOne({ _id: message.upgradeAgentID }, { projection },
				(err, result) => {
					if (err)
						return callback(new MongoError(err).log());

					if (result) {
						newToken = result.upgradeAgentToken;
						dbUpgradeAgent = result;
						isUpgradeAgentExists = true;
						currentTopics = result.topics;
						currentInteropDBVersion = result.upgradeAgentData.nvmeshVersions?.[consts.components.INTEROP_DB];
					} else {
						// first time we see this upgradeAgent
						newToken = message.upgradeAgentToken + 1;
					}

					callback();
				});
		},
		function createUpgradeAgentIfNeeded(callback) {
			if (isUpgradeAgentExists) return callback();

			createUpgradeAgent(message, (err, newUpgradeAgent) => {
				if (err) return callback(err);

				if (!newUpgradeAgent) return callback();

				events.emitEvent(null, objectNotifier.events.newUpgradeAgentEvent, newUpgradeAgent);
				sendUpdateUpgradeAgentKeepaliveTokenWithDebouncer(
					message.upgradeAgentID,
					newToken,
					null,
					newUpgradeAgent.topics[consts.topicSuffix.UPGRADE_AGENT_COMMANDS],
					callback
				);
			});
		},
		function handleVersionChangedIfNeeded(callback) {
			if (!isUpgradeAgentExists || !message.payload.featureCompatibilityVersion || !dbUpgradeAgent.upgradeAgentData.featureCompatibilityVersion)
				return callback();

			const versionComparisonResult =
					utils.compareVersionRelease(message.payload.featureCompatibilityVersion, dbUpgradeAgent.upgradeAgentData.featureCompatibilityVersion);
			if (versionComparisonResult <= 0) return callback();

			logger.sysDEBUG(`UpgradeAgent featureCompatibilityVersion changed for ${message.upgradeAgentID}! ` +
					`Before: ${dbUpgradeAgent.upgradeAgentData.featureCompatibilityVersion}, New ${message.payload.featureCompatibilityVersion}`);

			versionChanged = true;
			kafkaModule.createUpgradeAgentTopics(message.upgradeAgentID, message.payload.featureCompatibilityVersion, (err, topics) => {
				if (err) return callback(err);

				currentTopics = topics;
				callback();
			});
		},
		function updateUpgradeAgentIfNeeded(callback) {
			if (!isUpgradeAgentExists) return callback();

			// if upgradeAgent restarted
			if (message.upgradeAgentToken === -1) {
				return sendUpdateUpgradeAgentKeepaliveTokenWithDebouncer(
					message.upgradeAgentID,
					dbUpgradeAgent.upgradeAgentToken,
					dbUpgradeAgent.kafkaMessageSequence.keepalive,
					currentTopics[consts.topicSuffix.UPGRADE_AGENT_COMMANDS],
					callback
				);
			}

			updateUpgradeAgent(message, (err, updatedUpgradeAgent) => {
				if (err) return callback(err);

				if (updatedUpgradeAgent) {
					events.emitEvent([events.getUpgradeAgentID(updatedUpgradeAgent._id)], objectNotifier.events.upgradeAgentChangedEvent, updatedUpgradeAgent);

					if (versionChanged)
						new SystemAdminMessage(systemMessages.COMPONENT_VERSION_CHANGED)
							.addInfo(Entities.UpgradeAgent.ID, updatedUpgradeAgent._id)
							.addInfo(Entities.UpgradeAgent.featureCompatibilityVersion,
								dbUpgradeAgent.upgradeAgentData.featureCompatibilityVersion, Differentiators.Old)
							.addInfo(Entities.UpgradeAgent.featureCompatibilityVersion, message.payload.featureCompatibilityVersion, Differentiators.New)
							.log();

					if (currentInteropDBVersion &&
						currentInteropDBVersion !== updatedUpgradeAgent.upgradeAgentData.nvmeshVersions[consts.components.INTEROP_DB]) {
						logger.sysDEBUG(`Found InteropDB version change for ${updatedUpgradeAgent._id}`);
						events.emitEvent(
							[events.getUpgradeAgentID(updatedUpgradeAgent._id)],
							objectNotifier.events.interopDBVersionChangedEvent,
							{
								upgradeAgentID: updatedUpgradeAgent._id,
								oldInteropDBVersion: currentInteropDBVersion,
								newInteropDBVersion: updatedUpgradeAgent.upgradeAgentData.nvmeshVersions[consts.components.INTEROP_DB]
							}
						);
					}

				}

				if (newToken > message.upgradeAgentToken)
					return sendUpdateUpgradeAgentKeepaliveTokenWithDebouncer(
						message.upgradeAgentID,
						newToken,
						null,
						currentTopics[consts.topicSuffix.UPGRADE_AGENT_COMMANDS],
						callback
					);
				else if (shouldUpdateKeepaliveInterval)
					return sendUpdateUpgradeAgentKeepaliveTokenWithDebouncer(
						message.upgradeAgentID,
						dbUpgradeAgent.upgradeAgentToken,
						null,
						currentTopics[consts.topicSuffix.UPGRADE_AGENT_COMMANDS],
						callback
					);

				callback();
			});
		}],
	() => {
		mainCallback();
	});
};

function sendUpdateUpgradeAgentKeepaliveTokenWithDebouncer(upgradeAgentID, token, messageSequence, topic, callback) {
	const debouncerID = `${upgradeAgentID}_askForUpgradeAgentKeepAlive`;
	utils.callFunctionWithDebouncer(
		() => { sendUpdateUpgradeAgentKeepaliveTokenMessage(upgradeAgentID, token, messageSequence, topic); },
		debouncerID,
		consts.MINIMAL_TIME_BETWEEN_TOME_KEEPALIVE_REQUESTS
	);

	callback();
}

function sendUpdateUpgradeAgentKeepaliveTokenMessage(upgradeAgentID, token, messageSequence, topic, callback) {
	const keepaliveInterval = app.get('globalSettings').keepaliveIntervals.UPGRADE_AGENT;
	const message = new UpdateUpgradeAgentKeepaliveToken(upgradeAgentID, token, keepaliveInterval, messageSequence);

	kafkaModule.sendMessages(topic, [message], callback, true);
}

function deleteUpgradeAgent(upgradeAgent, callback) {
	const db = app.get('db');
	const upgradeAgentCollection = db.collection('upgradeAgent');
	const { _id: upgradeAgentID, uuid: upgradeAgentUUID } = upgradeAgent;
	let deletedUpgradeAgent;
	let message;

	async.series([
		(callback) => {
			const query = {
				_id: upgradeAgentID,
				uuid: upgradeAgentUUID,
				status: consts.upgradeAgentStatus.OFFLINE,
			};

			upgradeAgentCollection.findOneAndDelete(query, (err, dbUpgradeAgent) => {
				if (err) {
					callback(new MongoError(err).log());
				} else if (!dbUpgradeAgent) {
					callback(new SystemMessage(systemMessages.CANT_DELETE_UPGRADE_AGENT));
				} else {
					deletedUpgradeAgent = dbUpgradeAgent;
					eventsModule.emitEvent([eventsModule.getUpgradeAgentID(upgradeAgentID)], objectNotifier.events.upgradeAgentRemovedEvent, dbUpgradeAgent);

					message = new SystemAdminMessage(systemMessages.UPGRADE_AGENT_DELETED);
					callback();
				}
			});
		},
		(callback) => {
			lastMessageLog.deleteComponentLastMessageLog(consts.originTypes.UPGRADE_AGENT, upgradeAgentID, deletedUpgradeAgent.upgradeAgentToken, callback);
		}
	], (err) => {
		message = (err ? new SystemAdminMessage(systemMessages.UPGRADE_AGENT_DELETE_FAILED).addInfo(Entities.Error, err) : message)
			.addInfo(Entities.UpgradeAgent.ID, upgradeAgentID).addInfo(Entities.UpgradeAgent.UUID, upgradeAgentUUID);

		callback(err, message);
	});
}

scope.getAllUpgradeAgents = (queryObj, cb) => {
	utils.loadCollection('upgradeAgent', queryObj, function(err, upgradeAgents) {
		let error;


		if (err)
			error = new SystemMessage(systemMessages.FAILED_TO_LOAD_UPGRADE_AGENTS).addInfo(Entities.Error, err);

		return cb(error || upgradeAgents);
	});
};

scope.deleteUpgradeAgents = (upgradeAgents, cb) => {
	const messages = [];

	async.each(upgradeAgents, (upgradeAgent, callback) => {
		deleteUpgradeAgent(upgradeAgent, (err, message) => {
			messages.push(message);
			callback();
		});
	}, () => {
		cb(messages);
	});
};

scope.handleCommandResult = (message, callback) => {
	upgradeModule.updateStepResult(message, callback);
};

scope.requestFreshKeepalive = (upgradeAgentID, cb) => {
	const db = app.get('db');
	const upgradeAgentCollection = db.collection('upgradeAgent');

	upgradeAgentCollection.findOne({ _id: upgradeAgentID }, (err, upgradeAgent) => {
		if (err) return cb(new MongoError(err).log());

		if (!upgradeAgent) return cb(new SystemMessage(systemMessages.UPGRADE_AGENT_NOT_FOUND));

	 	return sendUpdateUpgradeAgentKeepaliveTokenMessage(
			upgradeAgent._id,
			upgradeAgent.upgradeAgentToken,
			null,
			upgradeAgent.topics[consts.topicSuffix.UPGRADE_AGENT_COMMANDS],
			cb
		);
	});
};

module.exports = scope;
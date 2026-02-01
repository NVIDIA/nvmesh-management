/*
 * SPDX-FileCopyrightText: Copyright (c) 2026 NVIDIA CORPORATION & AFFILIATES. All rights reserved.
 * SPDX-License-Identifier: Apache-2.0
 */

/* global app */

var async = require('async');

var logger = require('../logger.js');
var consts = require('../consts.js');
var zoneModule = require('./zone.js');
var lockModule = require('./lock.js');
var targetModule = require('./target.js');
var clientModule = require('./client.js');
var upgradeAgentModule = require('./upgradeAgent.js');

var { KafkaMessage } = require('../models/kafkaMessages/KafkaMessage');
var { MessageFromTOMA } = require('../models/kafkaMessages/MessageFromTOMA.js');
let { MongoError } = require('./error.js');

const keepaliveGracePeriodFactor = 3; // how many keepalives to consider stale
const components = [
	consts.originTypes.CLIENT,
	consts.originTypes.TOMA,
	consts.originTypes.TOMA_LEADER,
	consts.originTypes.MANAGEMENT_AGENT,
	consts.originTypes.UPGRADE_AGENT,
];

exports.afterModuleLoaded = function() {
	clientModule = require('./client.js');
	targetModule = require('./target.js');
	logger = require('../logger.js');
	({ MongoError } = require('./error.js'));
};

function handleTOMATimeout(targetID, tomaToken, tomaStatus, cb) {
	logger.sysDEBUG('handleTomaTimeout targetID: ' + targetID);
	targetModule.setTomaStatus(targetID, tomaStatus, tomaToken, cb);
}

function handleLeaderTimeout(zoneID, leaderToken, callback) {
	logger.sysDEBUG('handleLeaderTimeout of zone: ' + zoneID);
	zoneModule.setZoneAsUnavailable(zoneID, leaderToken, callback);
}

function handleAgentTimeout(nodeID, agentToken, msgSeq, callback) {
	logger.sysDEBUG(`MANAGEMENT_AGENT on ${nodeID} timeout setManagementAgentStatus token=${agentToken}`);
	clientModule.setManagementAgentStatus(nodeID, consts.managementAgentStatuses.DOWN, agentToken, msgSeq, null, null, callback);
}

//Generates the log messages we should log from the received msg (Both TOMA and Leader for example)
function generateLogMessagesIDs(originID, originType, isLeader, zone) {
	let leader = 'LEADER';
	let ids = [{ id: originID, type: originType }];

	if (isLeader && zone)
		ids.push({ id: leader, type: consts.originTypes.TOMA_LEADER, zone: zone });

	return ids;
}

exports.logMessage = function(message) {
	let db = app.get('db');
	let lastMessageLogCollection = db.collection('lastMessageLog');

	let isKafkaMessage = (message instanceof KafkaMessage);
	let isMessageFromTOMA = (message instanceof MessageFromTOMA);
	let isLeader = isMessageFromTOMA && message.isLeader();

	let messageType, messageSequence, originID, originType, zone, nodeID, token;

	async.series([
		(callback) => {
			if (!isLeader)
				return callback();

			zoneModule.getZonesByTargetIDs([message.hostname], (err, res) => {
				if (res)
					zone = Object.keys(res.zones)[0];

				callback();
			});
		}
	], () => {
		if (isKafkaMessage) {
			messageType = message.type;
			messageSequence = message.messageSequence;
			originID = message.getNodeID();
			nodeID = message.getNodeID();
			originType = message.originType;
		} else {
			messageType = message.obj.messageType;
			originID = message.obj?.registrant?.id;
			originType = message.obj?.registrant?.type;
			nodeID = message.id;

			if (!messageType) {
				logger.sysDEBUG('Someone is sending a message without a messageType! obj', message.obj);
				return;
			}

			if (!originType || originType.toLowerCase() === 'unknown' || originType.toLowerCase() === 'unkown') {
				logger.sysDEBUG('Someone is not providing registrant type! obj', message.obj);
				return;
			}
		}

		async.eachSeries(generateLogMessagesIDs(originID, originType, isLeader, zone), function(logMessageID, eachSeriesCallback) {
			// It is redundant to query the dateModified for being lte now, since we have no way to track the order of the messages
			let query = { _id: logMessageID };

			let $set = {
				messageType: messageType,
				status: consts.lastMessageLogStatuses.LIVE,
				nodeID: nodeID,
				messageSequence: messageSequence,
				origin: originID
			};

			if (logMessageID.type == consts.originTypes.TOMA_LEADER)
				token = message.leaderToken;
			else if (message.tomaToken >= 0)
				token = message.tomaToken;
			else if (message.mgmtAgentToken)
				token = message.mgmtAgentToken;
			else
				token = null;

			if (token) {
				query['$or'] = [{ token: { $exists: false } }, { token: { $lte: token } }];
				$set.token = token;
			}

			lastMessageLogCollection.updateOne(query, { $set: $set, $currentDate: { dateModified: true } }, { upsert: true }, function(err) {
				if (err) {
					err = new MongoError(err);
					if (!err.isDuplicateKeyError)
						err.log();
				}

				eachSeriesCallback();
			});
		});
	});
};

//The function will fetch a timed out component atomically, if succeeded it will change its status to "processing"
function getTimedOutComponent(callback) {
	const db = app.get('db');
	const lastMessageLogCollection = db.collection('lastMessageLog');
	const keepaliveIntervals = app.get('globalSettings').keepaliveIntervals;

	const queryComponents = components.map(componentType => {
		return {
			'_id.type': componentType,
			$expr: {
				$lt: [
					'$dateModified',
					{
						$dateSubtract: {
							startDate: '$$NOW',
							unit: 'millisecond',
							amount: keepaliveIntervals[componentType] * 1000 * keepaliveGracePeriodFactor
						}
					}
				]
			}
		};
	});

	lastMessageLogCollection.findOneAndUpdate({
		status: consts.lastMessageLogStatuses.LIVE,
		$or: queryComponents
	},
	{
		$set: {
			modifiedBy: app.get('managementId'),
			status: consts.lastMessageLogStatuses.HANDLING
		},
		$currentDate: { dateModified: true },
	},
	{ sort: { 'dateModified': 1 } },
	function(err, result) {
		if (err)
			new MongoError(err).log();

		if (!result)
			return callback();

		callback(result);
	});
}

function getAllTimedOutComponents(callback) {
	var shouldContinue = true;
	var timedOutComponents = [];

	async.doDuring(function(callback) {
		getTimedOutComponent(function(component) {
			shouldContinue = Boolean(component);

			if (shouldContinue)
				timedOutComponents.push(component);

			callback();
		});
	},
	function(callback) {
		return callback(null, shouldContinue);
	},
	function() {
		callback(timedOutComponents);
	});
}

function markComponentAsHandled(component, cb) {
	var db = app.get('db');
	var lastMessageLogCollection = db.collection('lastMessageLog');

	lastMessageLogCollection.updateOne({
		_id: component._id,
		modifiedBy: app.get('managementId'),
		status: consts.lastMessageLogStatuses.HANDLING
	}, {
		$set: { status: consts.lastMessageLogStatuses.TIMED_OUT }
	}, function(err, result) {
		if (err)
			new MongoError(err).log();

		if (result.matchedCount === 1 && result.modifiedCount !== 1)
			logger.sysDEBUG('It seems that although I was handling this component timed out event, I couldn\'t mark it as done.');

		cb();
	});
}

exports.handleTimedOutComponent = function(component, callback) {
	function cb() {
		markComponentAsHandled(component, function() {
			callback();
		});
	}

	var msgSeq = component.messageSequence;
	logger.DEBUG(`TimedOutComponent: ${component._id.type} ${component._id.id} timed-out`);

	switch (component._id.type) {
		// TOMA Timeout will affect the Target too
		case consts.originTypes.TOMA:
			handleTOMATimeout(component._id.id, component.token, consts.tomaStatuses.DOWN, cb);

			break;
		case consts.originTypes.TOMA_LEADER:
			handleLeaderTimeout(component._id.zone, component.token, cb);

			break;
		case consts.originTypes.MANAGEMENT_AGENT:
			handleAgentTimeout(component._id.id, component.token, msgSeq, cb);

			break;
		case consts.originTypes.CLIENT:
			clientModule.handleClientTimeout(component._id.id, cb);

			break;
		case consts.originTypes.UPGRADE_AGENT:
			upgradeAgentModule.handleUpgradeAgentTimeout(component._id.id, cb);

			break;
		case consts.originTypes.TARGET:
		default:
			logger.sysDEBUG('Not supported handleTimedOutComponent of component (Target should be handled as part of TOMA timeout', component);
			markComponentAsHandled(component, function() {
				callback();
			});
	}
};

function recoverStaleHandlings(callback) {
	const db = app.get('db');
	const lastMessageLogCollection = db.collection('lastMessageLog');
	const keepaliveIntervals = app.get('globalSettings').keepaliveIntervals;

	const queryComponents = components.map(componentType => {
		return {
			'_id.type': componentType,
			$expr: {
				$lt: [
					'$dateModified',
					{
						$dateSubtract: {
							startDate: '$$NOW',
							unit: 'millisecond',
							amount: keepaliveIntervals[componentType] * 1000 * keepaliveGracePeriodFactor
						}
					}
				]
			}
		};
	});

	lastMessageLogCollection.find({
		status: consts.lastMessageLogStatuses.HANDLING,
		$or: queryComponents
	}).toArray(function(err, results) {
		if (err)
			new MongoError(err).log();

		if (results && results.length)
			logger.sysDEBUG('Found stale lastMessageLog handling. It porbably means that a management machine started to handle it and was died/killed');

		async.eachSeries(results, function(lastMessageDoc, cb) {
			const managementId = app.get('managementId');

			if (lastMessageDoc.modifiedBy == managementId)
				// It's me! - recover
				return recoverStaleHandlingsComponenet(lastMessageDoc, cb);

			lockModule.checkIfRemoteManagementIsAlive(lastMessageDoc.modifiedBy, function(isAlive) {
				if (isAlive) return;
				recoverStaleHandlingsComponenet(lastMessageDoc, cb);
			});
		}, function() {
			callback();
		});
	});
}

function recoverStaleHandlingsComponenet(message, callback) {
	var db = app.get('db');
	var lastMessageLogCollection = db.collection('lastMessageLog');

	lastMessageLogCollection.updateOne({
		_id: message._id,
		dateModified: message.dateModified,
		status: consts.lastMessageLogStatuses.HANDLING,
		modifiedBy: message.modifiedBy
	}, {
		$set: {
			status: consts.lastMessageLogStatuses.LIVE,
			modifiedBy: app.get('managementId')
		}
	}, function(err) {
		if (err)
			new MongoError(err).log();

		callback();
	});
}

exports.startKeepaliveValidationInterval = function(callback) {
	const settings = app.get('globalSettings');
	const loopInterval = settings.keepaliveIntervals.TOMA * 1000;

	//Server start-up callback
	callback();

	function timeoutFunc() {
		recoverStaleHandlings(function() {
			getAllTimedOutComponents(function(timedOutComponents) {
				async.eachSeries(timedOutComponents, function(component, callback) {
					exports.handleTimedOutComponent(component, function() {
						callback();
					});
				}, function done() {
					setTimeout(timeoutFunc, loopInterval);
				});
			});
		});
	}

	timeoutFunc();
};

exports.deleteComponentLastMessageLog = function(type, componentID, componentToken, callback) {
	const db = app.get('db');
	const lastMessageLogCollection = db.collection('lastMessageLog');
	const query = {
		'_id.type': type,
		'_id.id': componentID,
		token: { $lte: componentToken }
	};
	
	lastMessageLogCollection.deleteOne(query, (err, res) => {
		if (err)
			return callback(new MongoError(err));

		if (res?.deletedCount != 1)
			logger.sysDEBUG(`failed to delete lastMessageLog for ${type} ${componentID} with token ${componentToken}`);

		callback();
	});
};

/*
 * SPDX-FileCopyrightText: Copyright (c) 2026 NVIDIA CORPORATION & AFFILIATES. All rights reserved.
 * SPDX-License-Identifier: Apache-2.0
 */

/* global app */

var async = require('async');
var uuid = require('uuid');
var moment = require('moment');

var utils = require('../utils.js');
var logger = require('../logger.js');
var consts = require('../consts.js');
var eventsModule = require('../events.js');
var objectNotifier = require('../objectNotifier.js');
var configurationProfile = require('./configurationProfiles');
var { ExecutionTimer } = require('../models/executionTimer.js');
var { MongoError, SystemMessage, Entities, SystemAdminMessage, Differentiators } = require('../modules/error.js');
var volumeModule = require('./volume.js');
var kafkaModule = require('./kafka.js');
var logModule = require('./log.js');
const systemMessages = require('../systemMessages.js');
const configurationProfiles = require('./configurationProfiles.js');
var lastMessageLog = require('./lastMessageLog.js');

const { BackoffError, Backoff } = require('../models/backoff.js');
const { UpdateClientToken } = require('../models/kafkaMessages/UpdateClientToken');
const { AttachVolumes } = require('../models/kafkaMessages/AttachVolumes.js');
const { DetachVolumes } = require('../models/kafkaMessages/DetachVolumes');
const { VolumeRemoved } = require('../models/kafkaMessages/VolumeRemoved');
const { UpdateAgentToken } = require('../models/kafkaMessages/UpdateAgentToken.js');
const { ReservationModeChange } = require('../models/kafkaMessages/ReservationModeChange.js');
const { UpdateVolumes } = require('../models/kafkaMessages/UpdateVolumes.js');
const { UpdateTargetNICs } = require('../models/kafkaMessages/UpdateTargetNICs');
const { UpdateVolumeEmulation } = require('../models/kafkaMessages/UpdateVolumeEmulation');
const { UpdateReferenceIDs } = require('../models/kafkaMessages/UpdateReferenceIDs.js');
const { AttachSatelliteResponse, AttachSatelliteResponseStatus } = require('../models/kafkaMessages/AttachSatelliteResponse.js');
const { PreemptClientFromCDV } = require('../models/kafkaMessages/PreemptClientFromCDV.js');
const { PreemptClientFromCDVResponse } = require('../models/kafkaMessages/PreemptClientFromCDVResponse.js');

var scope = {};

scope.afterModuleLoaded = function() {
	logger = require('../logger.js');
	configurationProfile = require('./configurationProfiles');
	objectNotifier = require('../objectNotifier.js');
	lastMessageLog = require('./lastMessageLog.js');
	eventsModule = require('../events.js');
	({ MongoError, SystemMessage, Entities, SystemAdminMessage } = require('../modules/error.js'));
};


scope.handleClientTimeout = function(clientID, cb) {
	scope.setClientOfflineAndIncToken(clientID, cb);
};

function getMarkAlreadyDetachedAttachmentsWithPendingPipeline() {
	const attachmentWishfulStateIsDetaching = { $eq: ['$$attachment.v.action', consts.volumeAttachmentActions.DETACHING] };
	const attachmentNotPendingOrPendingDetaching = {
		$or: [
			{ $not: ['$$attachment.v.pending'] },
			{ $eq: ['$$attachment.v.pending.action', consts.volumeAttachmentActions.DETACHING] }
		]
	};
	const filterMatchingBlockDevice = {
		$filter: {
			input: '$block_devices',
			as: 'blockDevice',
			cond: { $eq: ['$$blockDevice.uuid', '$$attachment.v.uuid'] }
		}
	};

	const matchingBlockDeviceNotExistsOrDetached = {
		$or: [
			{ $eq: [{ $size: '$$matchedBlockDevice' }, 0] },
			{
				$anyElementTrue: {
					$map: {
						input: '$$matchedBlockDevice',
						as: 'blockDevice',
						in: { $eq: ['$$blockDevice.vol_status', consts.volumeAttachmentStatus.DETACHED] }
					}
				}
			}
		]
	};

	return [
		{
			$set: {
				attachments: {
					$arrayToObject: {
						$map: {
							input: { $objectToArray: '$attachments' },
							as: 'attachment',
							in: {
								k: '$$attachment.k',
								v: {
									$let: {
										vars: { matchedBlockDevice: filterMatchingBlockDevice },
										in: {
											$cond: [
												{
													$and: [
														attachmentWishfulStateIsDetaching,
														attachmentNotPendingOrPendingDetaching,
														matchingBlockDeviceNotExistsOrDetached
													]
												},
												{
													$mergeObjects: [
														'$$attachment.v',
														{
															pending: {
																action: consts.volumeAttachmentActions.DETACHING_STALE
															}
														}
													]
												},
												'$$attachment.v'
											]
										}
									}
								}
							}
						}
					}
				}
			}
		}
	];
}

/**
* Removes from the client every attachment that has wishful state DETACHING
* and no reported block device or block device with vol_status = DETACHED
* Updating volume reservation
*/
scope.removeAlreadyDetachedAttachments = (clientID, cb) => {
	const db = app.get('db');
	const clientCollection = db.collection('client');

	if (!cb)
		cb = () => {};

	let detachedWishfulStateAttachments = [];

	async.series([
		function markAlreadyDetachedAttachmentsWithPendingPipeline(callback) {
			const pipeline = getMarkAlreadyDetachedAttachmentsWithPendingPipeline();
			clientCollection.findOneAndUpdate(
				{ _id: clientID },
				pipeline,
				{ returnDocument: consts.mongoReturnDocument.AFTER },
				(err, updatedClient) => {
					if (err)
						return callback(new MongoError(err));

					if (!updatedClient)
						return callback(new SystemMessage(systemMessages.CLIENT_NOT_FOUND).addInfo(Entities.Client.ID, clientID));


					detachedWishfulStateAttachments = Object.values(updatedClient.attachments)
						.filter(attachment => attachment?.pending?.action === consts.volumeAttachmentActions.DETACHING_STALE);

					callback();
				});
		},
		function updateReservationOnVolumes(callback) {
			async.each(detachedWishfulStateAttachments, (attachment, nextAttachment) => {
				setVolumeReservationOnClientRemoval(clientID, attachment, (err, updatedVolume) => {
					if (err || !updatedVolume) {
						if (err)
							new MongoError(err).log();
						else
							logger.sysDEBUG(`Failed to find the volume: ${attachment.name} that attached for the deleted client ${clientID}`);
					} else {
						sendReservationModeChangeMessageToTOMAIfNeeded(updatedVolume, err => err?.log());
					}

					nextAttachment();
				});
			}, callback);
		},
		function cleanupTPVState(callback) {
			cleanupTPVReferencesForDetachedClient(clientID, detachedWishfulStateAttachments, callback);
		},
		function removeAttachmentFromWishfulState(callback) {
			if (!detachedWishfulStateAttachments.length)
				return callback();

			clientCollection.findOneAndUpdate(
				{ _id: clientID },
				{
					$unset: detachedWishfulStateAttachments
						.reduce((acc, currAttachment) => { acc[`attachments.${currAttachment.uuid}`] = ''; return acc; }, {})
				},
				{ returnDocument: consts.mongoReturnDocument.AFTER },
				(err, updatedClient) => {
					if (err)
						return callback(new MongoError(err));

					if (!updatedClient)
						return callback(new SystemMessage(systemMessages.CLIENT_NOT_FOUND).addInfo(Entities.Client.ID, clientID));


					logger.sysDEBUG(`removeAlreadyDetachedAttachments: ${clientID} removed attachments:`, detachedWishfulStateAttachments);

					callback();
				});
		}
	],
	err => {
		if (err)
			err.log();

		cb();
	}
	);
};

scope.setClientOfflineAndIncToken = function(clientID, cb) {
	const db = app.get('db');
	const clientCollection = db.collection('client');

	const downStatus = consts.clientStatus.DOWN;
	const newHealth = consts.targetHealth.CRITICAL;

	const query = { _id: clientID };

	const $set = {
		client_status: downStatus,
		health: newHealth
	};

	// Zero all message sequence counters
	Object.values(consts.clientKafkaMessageSeqTypes).forEach(t => $set['kafkaMessageSequence.' + t] = 0);

	clientCollection.findOneAndUpdate(
		query,
		{
			$set: $set,
			$inc: {
				clientToken: 1,
				attachmentsVersion: 1
			}
		},
		function(err, originalClient) {
			if (!err && originalClient) {
				logger.sysDEBUG(`setClientOfflineAndIncToken: ${clientID} clientToken updated from `
					+ `${originalClient.clientToken} to ${originalClient.clientToken + 1}`);

				scope.removeAlreadyDetachedAttachments(clientID);

				if (originalClient.client_status !== downStatus) {
					// client went down
					var updatedClient = {
						clientID: clientID,
						client_status: downStatus,
						health: newHealth,
						health_old: originalClient.health,
					};

					eventsModule.emitEvent([eventsModule.getClientID(clientID)], objectNotifier.events.clientFailureEvent, updatedClient);
				}
			}

			if (cb)
				cb();
		}
	);
};

function shouldCalculateClientHealthOnClientChange(dbClientHealth, dbClientHasIODisabled, newClientStatus) {
	return dbClientHasIODisabled || !(dbClientHealth == consts.targetHealth.HEALTHY && newClientStatus == consts.clientStatus.READY)
		&& !(dbClientHealth == consts.targetHealth.CRITICAL && consts.clientCriticalStatuses.includes(newClientStatus));
}

scope.calculateAndSaveClientHealth = function(clientID) {
	var db = app.get('db');
	var clientCollection = db.collection('client');

	//TODO:We should add to this query a consideration of the snapshots as well, this was the code in master
	//var snapshotAttachmentExists = lastClient.attachments && Object.values(lastClient.attachments).some(a => 'snapshotStatus' in a);

	clientCollection.findOneAndUpdate(
		{ _id: clientID },
		[{
			$set: {
				health_old: '$health',
				health: {
					$cond: {
						if: {
							$or: [
								{ $in: ['$client_status', consts.clientCriticalStatuses] },
								{ $eq: ['$managementAgentStatus', consts.managementAgentStatuses.DOWN] }
							]
						},
						then: consts.targetHealth.CRITICAL,
						else: {
							$cond: {
								if: {
									$or: [
										{ $eq: ['$client_status', consts.clientStatus.PREP_RM] },
										{ $eq: ['$hasIoDisabled', true] }
									]
								},
								then: consts.targetHealth.ALARM,
								else: consts.targetHealth.HEALTHY
							}
						}
					}
				}
			}
		}],
		{ projection: { clientID: 1, client_status: 1, health: 1, health_old: 1 }, returnDocument: consts.mongoReturnDocument.AFTER },
		(err, client) => {
			if (err)
				new MongoError(err).log();

			if (client) {
				if (client.health != client.health_old)
					eventsModule.emitEvent([eventsModule.getClientID(clientID)], client.health === consts.targetHealth.HEALTHY
						? objectNotifier.events.clientWentOnlineEvent
						: objectNotifier.events.clientFailureEvent, client);
			}
		}
	);
};

scope.checkForAttachmentsNotInDesiredState = function(dbClient) {
	logger.sysDEBUG(`client ${dbClient._id} checkForAttachmentsNotInDesiredState called`);
	let volumesToAttach = [];
	let volumesToDetach = [];
	let blockDevices = {};

	dbClient.block_devices.forEach(bd => {
		blockDevices[bd.uuid] = bd;

		if (!dbClient.attachments[bd.uuid] && bd.vol_status != consts.volumeAttachmentStatus.DETACHED && !bd.is_hidden)
			// reported block device not in desired state
			volumesToDetach.push(bd);
	});


	let attachingStatuses = [
		consts.volumeAttachmentStatus.ATTACHING,
		consts.volumeAttachmentStatus.ATTACHED
	];
	let detachingStatuses = [
		consts.volumeAttachmentStatus.DETACHED,
		consts.volumeAttachmentStatus.DETACHING
	];

	for (let uuid in dbClient.attachments) {
		let wishfulState = dbClient.attachments[uuid];
		let bdev = blockDevices[uuid];

		// check if should attach
		if (wishfulState.action == consts.volumeAttachmentActions.ATTACHING) {
			//expected to be attached
			if (!bdev || detachingStatuses.includes(bdev.vol_status))
				//is not attached - resend AttachVolume
				volumesToAttach.push(wishfulState);
		}

		// check if should detach
		if (wishfulState.action == consts.volumeAttachmentActions.REATTACHING && bdev?.vol_status === consts.volumeAttachmentStatus.VOLUME_RESERVATION_DENIED ||
			wishfulState.action == consts.volumeAttachmentActions.DETACHING && (!bdev || attachingStatuses.includes(bdev.vol_status))) {
			volumesToDetach.push(wishfulState);
		}
	}

	return {
		volumesToAttach: volumesToAttach,
		volumesToDetach: volumesToDetach
	};
};


/**
 * Increments a client.attachmentsVersion
 * This is required when re-sending messages to client so they will be passed by MCS and handeled by the client
 */
scope.incClientAttachmentsVersion = function(dbClient, cb) {
	const db = app.get('db');
	const clientCollection = db.collection('client');

	const clientID = dbClient.clientID;
	const clientUUID = dbClient.uuid;

	const addInfoToError = (systemMessage) => {
		systemMessage
			.addInfo(Entities.Client.ID, clientID)
			.addInfo(Entities.Client.UUID, clientUUID);
		return systemMessage;
	};

	// inc the client global attachmentsVersion
	let incClientAttachmentsVersion = { attachmentsVersion: { $add: ['$attachmentsVersion', 1] } };

	let query = { _id: clientID, attachmentsVersion: dbClient.attachmentsVersion };

	clientCollection.findOneAndUpdate(
		query,
		[
			{ $set: incClientAttachmentsVersion },
		],
		{ returnDocument: 'after' },
		(err, updatedClient) => {
			if (err) {
				err = addInfoToError(new MongoError(err)).log();
				return cb(addInfoToError(new SystemMessage(systemMessages.INC_ATTACHMNETS_VERSION_FAILED, err)).log());
			}

			if (!updatedClient) {
				logger.sysDEBUG(`incClientAttachmentsVersion: ${clientID} was not found or updated with a new attachmentsVersion`);
				return cb();
			}

			logger.sysDEBUG(`incClientAttachmentsVersion: ${clientID} attachmentsVersion (dbAV) updated from `
				+ `${updatedClient.attachmentsVersion - 1} to ${updatedClient.attachmentsVersion}`);

			cb(null, updatedClient);
		});
};

scope.processVolumesToDetach = function(volumesToDetach, callback) {
	if (!volumesToDetach.length)
		return callback();

	const db = app.get('db');
	const volumeCollection = db.collection('volume');

	volumeCollection.aggregate([
		{ $match: { uuid: { $in: volumesToDetach.map(v => v.uuid) } } },
		{ $project: { uuid: 1 } },
		{
			$group: {
				_id: null,
				volumes: {
					$push: {
						k: '$uuid',
						v: '$$ROOT'
					}
				}
			}
		},
		{
			$replaceRoot: {
				newRoot: { $arrayToObject: '$volumes' }
			}
		}
	]).toArray((err, result) => {
		if (err)
			return callback(err);

		const volumesMap = result.length ? result[0] : {};
		const forceDetachVolumes = [];
		// Set force flag: true if volume doesn't exist in DB, false if it exists
		volumesToDetach.forEach(volumeToDetach => {
			volumeToDetach.force = !volumesMap[volumeToDetach.uuid];

			if (volumeToDetach.force)
				forceDetachVolumes.push(volumeToDetach);
		});

		if (forceDetachVolumes.length)
			logger.sysDEBUG(
				'These volumes should be detached but the volumes are already deleted. Issuing detach with force. force detach volumes: ' +
				forceDetachVolumes.map(v => `${v.name} (uuid: ${v.uuid})`).join(', ')
			);

		callback();
	});
};

scope.resendClientAttachDetachCommands = function(dbClient, cb) {
	const { volumesToAttach, volumesToDetach } = scope.checkForAttachmentsNotInDesiredState(dbClient);

	logger.sysDEBUG(`client ${dbClient._id} resendClientAttachDetachCommands found `
		+ `${volumesToAttach.length} volumesToAttach and ${volumesToDetach.length} volumesToDetach`);

	let originID = dbClient.clientOriginID;
	async.series([
		(callback) => {
			if (!volumesToAttach.length && !volumesToDetach.length)
				return callback();

			// we inc the client once and then send all messages with the new attachmentsVersion
			// both MCS and client should only compare the attachmentsVersion per volume
			// as long as it is higher than the previous known attachmentsVersion for that volume the message should be handled
			scope.incClientAttachmentsVersion(dbClient, (err, newDbClient) => {
				dbClient = newDbClient;
				callback(err);
			});
		},
		(callback) => {
			if (!dbClient || !volumesToAttach.length)
				return callback();

			sendConfigurationToAttachVolumes(dbClient, volumesToAttach, originID, callback);
		},
		(callback) => {
			if (!dbClient || !volumesToDetach.length)
				return callback();

			scope.processVolumesToDetach(volumesToDetach, err => {
				if (err)
					return callback(err);

				sendDetachVolumesToClient(
					dbClient.clientID,
					dbClient.topics[consts.topicSuffix.CLIENT_MAIN],
					volumesToDetach,
					dbClient.attachmentsVersion,
					originID
				);
				callback();
			});
		}
	], err => {
		if (cb)
			cb(err);
	});
};

scope.updateNvmfAttachedVolumes = function(clientID, nvmfAttachmentsID, nvmfAttachedVolumes) {
	var db = app.get('db');
	var clientCollection = db.collection('client');

	// update the whole nvmfAttachedVolumes array only if clientNvmfAttachmentsID is bigger then the one in the DB
	clientCollection.updateOne(
		{ _id: clientID, nvmfAttachmentsID: { $lt: nvmfAttachmentsID } },
		{ $set: { nvmfAttachmentsID: nvmfAttachmentsID, nvmfAttachedVolumes: nvmfAttachedVolumes } },
		(err) => {
			if (err)
				return new MongoError(err).log();
		}
	);
};

scope.sendVolumeRemovedToClients = (volume) => {
	volumeModule.getAttachedClientsForVolume(volume, (err, clients) => {
		if (err) {
			logger.sysDEBUG(`sendVolumeRemovedToClients: failed to fetch attached clients for volume: ${volume._id}`);
			return;
		}

		logger.sysDEBUG(`sendVolumeRemovedToClients: volume: ${volume._id} attached to clients:
			${JSON.stringify(clients.map(clnt => clnt.clientID))}`);

		if (clients.length > 0) {
			volume._id = volume.volumeID || volume.name || volume.id || volume.uuid;

			async.each(clients, (client, callback) => {
				const message = new VolumeRemoved(client.clientID, volume._id, volume.uuid, volume.health, volume.isReserved, client.clientOriginID);
				kafkaModule.sendMessages(client.topics[consts.topicSuffix.CLIENT_MAIN], [message], callback);
			}, () => {
			});

		}
	});
};

scope.sendUpdateClientTokenMessage = (clientID, clientUUID, token, attachmentsVersion, messageSequence, maxReportID, originID, topic) => {
	const GLOBAL_SETTINGS = app.get('globalSettings');
	const message = new UpdateClientToken(
		clientID,
		clientUUID,
		token,
		attachmentsVersion,
		messageSequence,
		maxReportID,
		originID,
		GLOBAL_SETTINGS.keepaliveIntervals.CLIENT);

	kafkaModule.sendMessages(topic, [message]);
};

function sendUpdateClientTokenMessageWithDebouncer(clientID, clientUUID, originID, clientToken, attachmentsVersion, kafkaMessageSequence, maxReportID, topic) {
	const debouncerID = clientID + '_sendClientToken';

	if (!clientUUID)
		throw new Error(`Missing clientUUID for UpdateClientTokenMessage with clientID: ${clientID}`);

	const sendUpdateClientTokenMessageFunction = () =>
		scope.sendUpdateClientTokenMessage(
			clientID,
			clientUUID,
			clientToken,
			attachmentsVersion,
			utils.getMaxMessageSequence(kafkaMessageSequence),
			maxReportID,
			originID,
			topic);

	utils.callFunctionWithDebouncer(sendUpdateClientTokenMessageFunction, debouncerID);
}

scope.calcAttachmentsUUIDHash = function(dbClient, createFromBlockDevices) {
	let stringExpression;

	if (createFromBlockDevices)
		stringExpression = Object.values(dbClient.block_devices)
			.filter(a => a.vol_status === consts.volumeAttachmentStatus.ATTACHED)
			.map(a => a.uuid);
	else
		stringExpression = Object.values(dbClient.attachments)
			// we use both ATTACHING and DETACHING wishful states, but since use only the uuid we need a postfix of the action for all others
			// to distinguish them from ATTACHING
			.filter(a => [consts.volumeAttachmentActions.ATTACHING, consts.volumeAttachmentActions.DETACHING].includes(a.action))
			.map(a => (a.action == consts.volumeAttachmentActions.ATTACHING) ? a.uuid : a.uuid + '-' + a.action);

	stringExpression = stringExpression.sort().join(';');

	let uuidHash = stringExpression ? utils.md5(stringExpression) : stringExpression;
	return uuidHash;
};

function handleClientFirstKeepAlive(message, callback) {
	const { clientID, originID, payload: { featureCompatibilityVersion } } = message;
	const db = app.get('db');
	const clientCollection = db.collection('client');
	const projection = { uuid: 1, clientToken: 1, attachmentsVersion: 1, kafkaMessageSequence: 1, maxReportID: 1, topics: 1, featureCompatibilityVersion: 1 };

	clientCollection.findOne({ _id: clientID }, { projection }, (err, dbClient) => {
		if (err)
			return callback(new MongoError(err).log());

		if (!dbClient || dbClient.featureCompatibilityVersion !== featureCompatibilityVersion) {
			const reason = dbClient ?
				`Feature compatibility version mismatch (${dbClient.featureCompatibilityVersion} !== ${featureCompatibilityVersion})` :
				'Client not found';
			logger.sysDEBUG(`${reason} for client ${clientID}. Retrying`);
			return setTimeout(() => { handleClientFirstKeepAlive(message, callback); }, 1000);
		}

		sendUpdateClientTokenMessageWithDebouncer(
			clientID,
			dbClient.uuid,
			originID,
			dbClient.clientToken,
			dbClient.attachmentsVersion,
			dbClient.kafkaMessageSequence,
			dbClient.maxReportID,
			dbClient.topics[consts.topicSuffix.CLIENT_MAIN]);

		callback();
	});
}

function getHasIODisabledSetQuery() {
	const numberOfIODisabledBlockDevices = {
		$size: {
			$filter: {
				input: '$block_devices',
				as: 'block_device',
				cond: {
					$and: [
						{ $ne: ['$$block_device.ioEnabled', 1] },
						{ $ne: ['$$block_device.is_hidden', 1] },
						{ $ne: ['$$block_device.vol_status', consts.volumeAttachmentStatus.DETACHED] },
					]
				}
			}
		}
	};

	return {
		$cond: {
			if: { $gte: [numberOfIODisabledBlockDevices, 1] },
			then: true,
			else: false
		}
	};
}

function clearHiddenAttachments(clientID, dbMaxReportID, messageType, kaMessageSequence) {
	const db = app.get('db');
	const clientCollection = db.collection('client');

	// clear all hidden attachments (both Recovery and Shadow) only if there was no new KA that was saved
	// and no new updateAttachmentsStatus saved (maxReportID is the same)
	clientCollection.updateOne(
		{
			_id: clientID,
			maxReportID: dbMaxReportID,
			[`kafkaMessageSequence.${messageType}`]: kaMessageSequence
		}, {
			$pull: { block_devices: { is_hidden: 1 } }
		},
		(err, result) => {
			if (err)
				return new MongoError(err).log();

			if (result.modifiedCount)
				logger.sysDEBUG(`Removed orphan recovery attachments on Client ${clientID}`);
		}
	);
}

scope.handleClientKeepalive = (message, callback) => {
	if (message.clientToken === -1)
		return handleClientFirstKeepAlive(message, callback);

	const db = app.get('db');
	const clientCollection = db.collection('client');
	const GLOBAL_SETTINGS = app.get('globalSettings');
	const { clientID, originID, messageSequence, isUmClient, payload: { attachmentsVersion } } = message;
	const now = new Date();
	const logPrefix = `client ${clientID} keepalive:`;
	const keepaliveInterval = GLOBAL_SETTINGS.keepaliveIntervals.CLIENT;
	let shouldUpdateKeepaliveInterval;

	if (keepaliveInterval !== message.keepaliveInterval) {
		logger.sysDEBUG(`${logPrefix} `
			+ `Unexpected Client keepaliveInterval, configured: ${keepaliveInterval} actual: ${message.keepaliveInterval}`);
		shouldUpdateKeepaliveInterval = true;
	}

	const query = {
		_id: clientID,
		clientToken: message.clientToken,
		[`kafkaMessageSequence.${message.type}`]: { $lt: message.messageSequence }
	};

	const update = utils.setUpdateOperators(message.payload);
	update.$set.hasIoDisabled = getHasIODisabledSetQuery();
	update.$set.clientOriginID = originID;
	update.$set.lastReceivedClientKeepAlive = now;
	update.$set.dateModified = now;
	update.$set[`kafkaMessageSequence.${message.type}`] = messageSequence;
	update.$set.isUmClient = isUmClient;

	update.$set.isNewClient = '$$REMOVE'; // as we can't use $unset is not supported in update aggregation pipeline, we must remove isNewClient that way

	// adopt attachmnetsVersion of client if client deleted from db.
	update.$set.attachmentsVersion = {
		$cond: {
			if: { $and: [{ $eq: ['$attachmentsVersion', consts.INITIAL_ATTACHMENTS_VERSION] }, { $lt: ['$attachmentsVersion', attachmentsVersion] }] },
			then: attachmentsVersion,
			else: '$attachmentsVersion'
		}
	};

	// sets or clears attachmentsVersionMissmatchTime based on db.attachmentsVersion == message.attachmentsVersion
	update.$set.attachmentsVersionMissmatchTime = {
		$cond: {
			if: { $eq: ['$attachmentsVersion', attachmentsVersion] },
			then: '$$REMOVE',
			else: {
				$cond: {
					if: '$attachmentsVersionMissmatchTime',
					then: '$attachmentsVersionMissmatchTime',
					else: now
				}
			}
		}
 	};

	delete update.$set.attachmentsUUIDHash;

	const options = { returnOriginal: true };

	clientCollection.findOneAndUpdate(query, [update], options, (err, lastClient) => {
		if (err)
			return callback(new MongoError(err).log());

		if (!lastClient) {
			logger.sysDEBUG(`${logPrefix} client was not updated by keepalive. query=${JSON.stringify(query)}`);
			return resendClientTokenIfNeeded(clientID, message.clientToken, originID, shouldUpdateKeepaliveInterval, callback);
		}

		// TODO: whenever we have support for recovery in UM we need to consider it as well
		if (!isUmClient && 'nHiddenVolumes' in message.payload && message.payload.nHiddenVolumes === 0)
			clearHiddenAttachments(clientID, lastClient.maxReportID, message.type, messageSequence);

		// handle configProfile report
		if (lastClient.restartRequired)
			configurationProfile.handleComponentConfigProfileReport(
				'client', clientID, message.payload.configProfile, (err, canRemoveRestartRequired) => {
					if (err)
						logger.sysDEBUG(`${logPrefix} Error updating config profile version from target report`);

					if (canRemoveRestartRequired)
						scope.removeRestartRequired(clientID);
				});

		if (shouldCalculateClientHealthOnClientChange(lastClient.health, lastClient.hasIoDisabled, update.$set.client_status))
			scope.calculateAndSaveClientHealth(clientID);

		if (shouldUpdateKeepaliveInterval)
			sendUpdateClientTokenMessageWithDebouncer(
				clientID,
				lastClient.uuid,
				originID,
				lastClient.clientToken,
				lastClient.attachmentsVersion,
				lastClient.kafkaMessageSequence,
				lastClient.maxReportID,
				lastClient.topics[consts.topicSuffix.CLIENT_MAIN]);

		if (!message.payload.hasWIPOperations) {
			let avMissmatchedForTooLong = attachmentsVersion != lastClient.attachmentsVersion
				&& lastClient.attachmentsVersionMissmatchTime
				&& (now - lastClient.attachmentsVersionMissmatchTime) > keepaliveInterval * 3 * 1000
				&& lastClient.attachmentsVersionMissmatchTrigger != attachmentsVersion;

			if (avMissmatchedForTooLong)
				logger.sysDEBUG(`${logPrefix} attachmentsVersion missmatched for more than`
					+ ` ${keepaliveInterval * 3} seconds - calling checkAttachmentAndVolumeHashes.`
					+ ` dbAV=${lastClient.attachmentsVersion} reportedAV=${attachmentsVersion}`
					+ ` last avMissmatchTrigger=${lastClient.attachmentsVersionMissmatchTrigger} `
					+ ` last avMissmatchTime=${lastClient.attachmentsVersionMissmatchTime}`);

			if (attachmentsVersion == lastClient.attachmentsVersion || avMissmatchedForTooLong) {
				checkAttachmentAndVolumeHashes(message, lastClient, avMissmatchedForTooLong);
			} else {
				logger.sysDEBUG(`${logPrefix} skipping hashes comparison since client ${clientID} is not up-to-date.`
					+ ` message.payload.attachmentsVersion(${message.payload.attachmentsVersion}) !=`
					+ ` lastClient.attachmentsVersion(${lastClient.attachmentsVersion})`);
			}
		} else {
			logger.sysDEBUG(`${logPrefix} skipping hashes comparison since hasWIPOperations = ${message.payload.hasWIPOperations}`);
		}

		callback();
	});
};

/**
 * set dbClient.attachmentsVersionMissmatchTrigger - which is the last reported AV that triggered an AttachmentHash check
 */
function setAttachmentVersionMissmatchTrigger(clientID, attachmentsVersion) {
	const db = app.get('db');
	const clientCollection = db.collection('client');

	let $set = {
		attachmentsVersionMissmatchTrigger: attachmentsVersion,
		attachmentsVersionMissmatchTime: new Date()
	};
	clientCollection.updateOne({ _id: clientID }, { $set: $set });
}

function checkAttachmentAndVolumeHashes(message, lastClient, avMissmatchedForTooLong) {
	const { clientID } = message;
	// check mismatch between mgmt and client on wishful
	let dbAttachmentsUUIDHash = scope.calcAttachmentsUUIDHash(lastClient, false);
	if (dbAttachmentsUUIDHash !== message.payload.attachmentsUUIDHash) {
		doOnAttachmentsUUIDHashMissmtach(message, dbAttachmentsUUIDHash, lastClient, false);
		if (avMissmatchedForTooLong)
			setAttachmentVersionMissmatchTrigger(clientID, message.payload.attachmentsVersion);
	} else if (!avMissmatchedForTooLong) {
		// Wishful state is synced - checking now that client is updated with latest version of each volume
		calcVolumeVersionsSum(lastClient, (expectedVolumeVersionsSum, volumes) => {
			if (expectedVolumeVersionsSum !== message.payload.volumeVersionsSum) {
				logger.sysDEBUG(`client ${clientID} sumOfVolumeVersions mismatch `
					+ `client reported("${message.payload.volumeVersionsSum}") != expected("${expectedVolumeVersionsSum}")`);

				doOnVolumeVersionsSumMismatch(lastClient, volumes);
			} else {
				// if all is well with the volume versions then check if the block devices picture equals what we expect
				// (latest client reflected attachments in our DB)
				let dbBlockDevicesUUIDHash = scope.calcAttachmentsUUIDHash(lastClient, true);
				if (dbBlockDevicesUUIDHash !== message.payload.attachmentsUUIDHash)
					doOnAttachmentsUUIDHashMissmtach(message, dbAttachmentsUUIDHash, lastClient, true);
			}
		});
	}
}

/**
 * calculates volumeVersionsSum bassed on dbClient
 */
function calcVolumeVersionsSum(dbClient, callback) {
	let volumes = getUUIDsForVolumeVersionsSum(dbClient);
	utils.getVolumeVersionsSumByVolumeUUIDs(volumes.map(v => v.uuid), volumeVersionSum => {
		callback(volumeVersionSum, volumes);
	});
}

function doOnAttachmentsUUIDHashMissmtach(message, dbAttachmentsUUIDHash, dbClient, isBlockDevicesUUIDHash) {
	logger.sysDEBUG(`client ${message.clientID} ${isBlockDevicesUUIDHash ? 'blockDevicesUUIDHash' : 'attachmentsUUIDHash'} mismatch `
		+ `clients attachmentsUUIDHash("${message.payload.attachmentsUUIDHash}") != `
		+ `${isBlockDevicesUUIDHash ? 'blockDevicesUUIDHash' : 'dbAttachmentsUUIDHash'}("${dbAttachmentsUUIDHash}")`);
	resendClientAttachDetachCommandsWithDebouncer(dbClient);
}

function resendClientAttachDetachCommandsWithDebouncer(dbClient) {
	let resendClientAttachDetachCommandsWrapper = () => scope.resendClientAttachDetachCommands(dbClient);
	const debouncerID = 'client_' + dbClient._id + '_resendClientAttachDetachCommands';
	const debounceFor20Seconds = 20000;
	utils.callFunctionWithDebouncer(resendClientAttachDetachCommandsWrapper, debouncerID, debounceFor20Seconds);
}

function doOnVolumeVersionsSumMismatch(dbClient, volumes) {
	if (!volumes.length)
		return;

	let clientID = dbClient.clientID;
	let resendUpdateForAllClientVolumes = () => {
		let clients = [dbClient];
		sendUpdateConfiguration(volumes, clients, errs => {
			if (errs && errs.length)
				logger.sysDEBUG(`Failed to send UpdateVolume to client ${clientID} after somOfVolumeVersions mismatch. Errors: ${JSON.stringify(errs)}`);
		});
	};

	const debouncerID = 'client_' + clientID + '_resendUpdateForAllClientVolumes';
	const debounceFor10Seconds = 10000;
	utils.callFunctionWithDebouncer(resendUpdateForAllClientVolumes, debouncerID, debounceFor10Seconds);
}

/**
 * Collects uuids from both wishful state and reported state (to include hidden block devices)
 * @param {object} dbClient
 * @returns Array of UUIDs to be part of the sumOfVolumesVersion
 */
function getUUIDsForVolumeVersionsSum(dbClient) {
	let volumesByUUID = {};

	// collect attachments
	Object.keys(dbClient.attachments).forEach(uuid => {
		volumesByUUID[uuid] = { name: dbClient.attachments[uuid].name, uuid: uuid };
	});

	return Object.values(volumesByUUID);
}

function checkForVolumesToReattach(reportedAttachment, attachmentWishfulState, volumesToReattach) {
	if (!attachmentWishfulState)
		return;

	const shouldSetVolumeToReattach = attachmentWishfulState.action === consts.volumeAttachmentActions.ATTACHING
		&& reportedAttachment.reservation.version < attachmentWishfulState.reservation.version;

	if (shouldSetVolumeToReattach) {
		let debug = `Looks like attachment ${reportedAttachment.uuid}`;

		if (reportedAttachment.reservation.mode === attachmentWishfulState.reservation.mode)
			debug += ' incremented the reservation version'
				+ `from ${reportedAttachment.reservation.version} to ${attachmentWishfulState.reservation.version}. But the mode remained the same.`;
		else
			debug += ' changed reservation mode'
				+ ` from ${reportedAttachment.reservation.mode} to ${attachmentWishfulState.reservation.mode}.`;

		debug += ` Setting its action to ${consts.volumeAttachmentActions.REATTACHING} and detaching it.`;
		logger.sysDEBUG(debug);

		volumesToReattach.push(reportedAttachment);
	}
}

function getClientForUpdateAttachment(clientID, cb) {
	const db = app.get('db');
	const clientCollection = db.collection('client');

	clientCollection.findOne(
		{ _id: clientID },
		{ projection: { block_devices: 0 } },
		(err, client) => {
			if (err) {
				new MongoError(err).log();
				return cb();
			}

			cb(client);
		});
}

scope.handleUpdateAttachment = function(message, cb) {
	getClientForUpdateAttachment(message.clientID, client => {
		async.eachSeries(message.payload.attachments, (attachment, eachCB) => {
			scope.handleSingleUpdateAttachment(attachment, message.payload.reportID, message.clientID, message.clientToken, client, err => {
				let msgID = `client: ${message.clientID} reportID: ${message.payload.reportID} volume.name: ${attachment.name} volume.uuid: ${attachment.uuid}`;
				if (err)
					logger.sysDEBUG(`updateAttachmentStatus failed for ${msgID} error: ${err}`, message);
				else
					logger.sysDEBUG(`updateAttachmentStatus finished successfully for: ${msgID}`);
				eachCB();
			});
		}, cb);
	});
};

scope.handleSingleUpdateAttachment = function(blockDevice, messageReportID, clientID, clientToken, client, cb) {
	const db = app.get('db');
	const clientCollection = db.collection('client');

	if (!client) {
		return cb('While handling updateAttachmentStatus, failed to find suitable client. '
			+ `clientID: ${clientID} clientToken:${clientToken} messageReportID:${messageReportID}`);
	}

	let volumesToReattach = [];
	let shouldReattach = false;
	let shouldAttach = false;
	let shouldIncAttachmentsVersion = false;
	let shouldRemoveFromWishfulState = false;
	let shouldUpdateReservationOnVolume = false;
	let isVolumeAlreadyDeleted = false;
	let dbVolume;

	const isHidden = blockDevice.is_hidden;
	const volumeUUID = blockDevice.uuid;

	overrideVolumeStatusIfNeeded(blockDevice);

	const attachmentWishfulState = client.attachments[volumeUUID];
	if (!attachmentWishfulState) {
		logger.DEBUG(`Attachment ${volumeUUID} reported in updateAttachmentStatus with status ${blockDevice.vol_status}, `
			+ 'but it\'s missing from the wishful state object. we will still process this message');
		// We will still process this message, keepalive attachmentsUUIDHash would send DetachVolumes on missmatch
	} else if (attachmentWishfulState.pending && !attachmentWishfulState.action) {
		return cb(`Attachment ${volumeUUID} reported in updateAttachmentStatus with status ${blockDevice.vol_status}, `
			+ 'but it\'s pending and not attached before. Skipping handling of this attachment.');
	}

	switch (blockDevice.vol_status) {
		case consts.volumeAttachmentStatus.VOLUME_RESERVATION_DENIED:
			if (!isHidden) {
				checkForVolumesToReattach(blockDevice, attachmentWishfulState, volumesToReattach);
				shouldReattach = !!volumesToReattach.length;
			}
			break;

		case consts.volumeAttachmentStatus.ATTACHED:
			break;

		case consts.volumeAttachmentStatus.DETACHED:
			if (!isHidden && attachmentWishfulState)
				if (attachmentWishfulState.action === consts.volumeAttachmentActions.REATTACHING) {
					shouldAttach = true;
				} else if (attachmentWishfulState.action === consts.volumeAttachmentActions.DETACHING) {
					shouldUpdateReservationOnVolume = true;
					shouldRemoveFromWishfulState = true;
				}

			break;
		default:
			return cb(`updateAttachmentStatus: Unhandled vol_status=${blockDevice.vol_status}`);
	}

	async.series([
		function updateClientWithPendingAttachment(callback) {
			if (!shouldUpdateReservationOnVolume)
				return callback();

			const pendingAttachment = {
				uuid: blockDevice.uuid,
				pending: {
					action: consts.volumeAttachmentActions.DETACHING,
					handledBy: utils.getHandlingMgmtParams()
				}
			};
			const attachmentsUpdatePipeline = getUpdatePendingAttachmentsPipeline([pendingAttachment]);
			const projection = { attachments: 1 };
			clientCollection.findOneAndUpdate(
				{ _id: clientID },
				attachmentsUpdatePipeline,
				{ returnDocument: consts.mongoReturnDocument.BEFORE, projection: projection },
				(err, originalClient) => {
					let sysErr;
					let isAlreadyPendingAttachment = false;

					if (err) {
						new MongoError(err).log();
						sysErr = systemMessages.PENDING_DETACH_VOLUME_UPDATE_ERROR;
					} else if (!originalClient) {
						sysErr = systemMessages.CLIENT_NOT_FOUND;
					} else {
						const isVolumeAlreadyDetached = !originalClient.attachments[blockDevice.uuid];
						if (isVolumeAlreadyDetached) {
							sysErr = new SystemMessage(systemMessages.VOLUME_NOT_ATTACHED);
						} else {
							isAlreadyPendingAttachment = originalClient.attachments[blockDevice.uuid].pending;
							if (isAlreadyPendingAttachment)
								sysErr = 'The attachment is pending, thus the reservation and wishful state changed, skipping this detach update';
						}

						if (sysErr && !isAlreadyPendingAttachment)
							return clearPendingWishfulStateForFailedDetachment(clientID, blockDevice.uuid, () => callback(sysErr));
					}

					callback(sysErr);
				}
			);
		},
		function updateVolumeReservationIfDetached(callback) {
			if (!shouldUpdateReservationOnVolume)
				return callback();

			// remove the client from the volume's reservation ref set
			// change mode to NONE if needed
			setVolumeReservationOnClientRemoval(clientID, blockDevice, (err, updatedVolume) => {
				if (err) {
					err = new MongoError(err);
					err.log();
					return callback(err);
				} else if (!updatedVolume) {
					logger.sysDEBUG(
						'Failed to find the volume for detach reservation update, the volume is deleted. Skipping TOMA message, cleaning wishful state.',
						{ clientID, blockDevice }
					);
					isVolumeAlreadyDeleted = true;
				}

				dbVolume = updatedVolume;
				callback();
			});
		},
		function sendReservationModeChangeMessageToTOMA(callback) {
			if (!shouldUpdateReservationOnVolume || isVolumeAlreadyDeleted)
				return callback();

			sendReservationModeChangeMessageToTOMAIfNeeded(dbVolume, err => {
				if (!err)
					return callback();

				err.log();
				logger.sysDEBUG('Failed to sendReservationModeChangeMessageToTOMA, removing pending' +
					`for client: ${clientID} attachment: ${blockDevice.name} ${blockDevice.uuid}`);
				clearPendingWishfulStateForFailedDetachment(clientID, blockDevice.uuid, () => callback(err));
			});
		},
		function updateClient(callback) {
			// ! exists || exists and vol status is the newly created one (attach_removed/detached)
			const query = { _id: clientID };

			const blockDeviceNotExists = { block_devices: { $not: { $elemMatch: { uuid: volumeUUID } } } };
			const blockDeviceReportIDSmaller = { block_devices: { $elemMatch: { uuid: volumeUUID, reportID: { $lt: messageReportID } } } };

			query.$or = [blockDeviceNotExists, blockDeviceReportIDSmaller];

			const isWishfulStateUpdated = shouldRemoveFromWishfulState || shouldReattach || shouldAttach;
			if (isWishfulStateUpdated)
				query[`attachments.${volumeUUID}.attachmentsVersion`] = client.attachments[volumeUUID].attachmentsVersion;

			blockDevice.reportID = messageReportID;
			const updatePipeline = [];

			const $updateSetStage = {
				$set: {
					maxReportID: { $max: ['$maxReportID', messageReportID] }
				}
			};
			updatePipeline.push($updateSetStage);

			const $updateUnsetStage = {};

			if (shouldRemoveFromWishfulState) {
				$updateUnsetStage.$unset = [`attachments.${volumeUUID}`];
				updatePipeline.push($updateUnsetStage);
			}

			if (shouldReattach) {
				shouldIncAttachmentsVersion = true;
				$updateSetStage.$set[`attachments.${volumeUUID}.action`] = consts.volumeAttachmentActions.REATTACHING;
			} else if (shouldAttach) {
				shouldIncAttachmentsVersion = true;
				$updateSetStage.$set[`attachments.${volumeUUID}.action`] = consts.volumeAttachmentActions.ATTACHING;
			}

			if (shouldIncAttachmentsVersion)
				$updateSetStage.$set.attachmentsVersion = { $add: ['$attachmentsVersion', 1] };

			const bdevArrToConcat = isVolumeAlreadyDeleted ? [] : [blockDevice];
			$updateSetStage.$set.block_devices = {
				$concatArrays: [{
					$filter: {
						input: '$block_devices',
						as: 'device',
						cond: { $ne: ['$$device.uuid', volumeUUID] }
					}
				}, bdevArrToConcat]
			};

			const projection = { block_devices: 0 };
			clientCollection.findOneAndUpdate(query, updatePipeline, { projection: projection }, (err, savedClient) => {
				if (err)
					return callback(new MongoError(err).log());

				if (savedClient) {
					logger.sysDEBUG(`updateAttachmentStatus saved successfully from client: ${clientID} for volume: ${blockDevice.name}`
						+ ` uuid: ${blockDevice.uuid} with reportID: ${messageReportID} `);

					if (shouldCalculateClientHealthOnClientChange(savedClient.health, savedClient.hasIoDisabled, client.client_status))
						scope.calculateAndSaveClientHealth(clientID);

					if (shouldIncAttachmentsVersion)
						logger.sysDEBUG(`updateAttachmentStatus client: ${clientID} updateAttachmentStatus `
							+ `for volume: ${blockDevice.name} - attachmentsVersion incremented`);

					if (shouldReattach) {
						logger.sysDEBUG(`updateAttachmentStatus client: ${clientID} updateAttachmentStatus `
							+ `for volume: ${blockDevice.name} - started reattach - detaching volume`);
						sendDetachVolumesToClient(
							clientID,
							savedClient.topics[consts.topicSuffix.CLIENT_MAIN],
							volumesToReattach,
							savedClient.attachmentsVersion + 1,
							savedClient.clientOriginID
						);
					}

					if (shouldAttach) {
						logger.sysDEBUG(`updateAttachmentStatus client: ${clientID} updateAttachmentStatus `
							+ `for volume: ${blockDevice.name} - finishing reattach - attaching volume`);
						sendAttachVolumes(clientID, savedClient.attachmentsVersion + 1, [volumeUUID]);
					}

					return callback(err);
				} else {
					let skippedErr = `updateAttachmentStatus: ${clientID} ${blockDevice.name} skipped. query: ${JSON.stringify(query)}`;
					if (shouldUpdateReservationOnVolume)
						// we set pending on the attachmnet initially but the update query failed, so we need to clear the pending
						return clearPendingForFailedUpdateAttachmentStatus(clientID, blockDevice.uuid, () => {
							callback(skippedErr);
						});

					return callback(skippedErr);
				}
			});
		}
	], err => { cb(err); });
};

function sendAttachVolumes(clientID, attachmentsVersion, volumesToAttachUUIDs) {
	const db = app.get('db');
	const clientCollection = db.collection('client');

	async.waterfall([
		function getAttachmentsWishfulState(callback) {
			clientCollection.findOne({
				_id: clientID,
				attachmentsVersion: attachmentsVersion
			}, (err, client) => {
				if (err) {
					err = new MongoError(err).log();
				} else if (!client) {
					logger.sysDEBUG(
						'While trying to send configuration to attach volumes from updateAttachmentStatus, '
						+ 'could not find the client. Probably attachmentsVersion changed.',
						{ clientID: clientID, attachmentsVersion: attachmentsVersion, volumesToAttachUUIDs: volumesToAttachUUIDs }
					);
				}

				callback(err, client);
			});
		},
		function sendConfiguration(client, callback) {
			if (!client)
				return callback();

			sendConfigurationToAttachVolumes(client, volumesToAttachUUIDs.map(volumeUUID => client.attachments[volumeUUID]), client.clientOriginID, callback);
		}
	], err => {
		if (err)
			err.log();
	});
}

function setVolumeReservationOnClientRemoval(clientID, attachment, cb) {
	const db = app.get('db');
	const volumeCollection = db.collection('volume');

	const pipeline = getUpdateVolumeReservationPipeline(clientID);
	volumeCollection.findOneAndUpdate(
		{ uuid: attachment.uuid },
		pipeline,
		{ returnDocument: consts.mongoReturnDocument.AFTER },
		cb
	);
}

function setAttachmentOnConfigResponses(configResponse, attachingVolumes) {
	let attachingVolumesMap = {};
	attachingVolumes.forEach(volume => { attachingVolumesMap[volume.uuid] = volume; });

	configResponse.forEach(res => {
		if (res.volumes)
			res.volumes = res.volumes.map(volume => (
				{
					_id: volume.name,
					uuid: volume.uuid,
					configuration: volume,
					attachment: {
						emulation: attachingVolumesMap[volume.uuid].emulation,
						version: attachingVolumesMap[volume.uuid].version,
						attachmentsVersionRef: attachingVolumesMap[volume.uuid].attachmentsVersionRef,
						referenceIDs: attachingVolumesMap[volume.uuid].referenceIDs,
						...(attachingVolumesMap[volume.uuid].isHidden && { isHidden: true })
					}
				}
			));
	});
}

function sendConfigurationToAttachVolumes(client, volumesToAttach, originID, cb) {
	const alreadyDetachedVolumes = new Set(volumesToAttach.filter(vol => !client.attachments[vol.uuid]).map(vol => vol.name));
	alreadyDetachedVolumes.forEach(
		vol => logger.sysDEBUG(`Looks like volume ${vol} is already detached, it will not be included in the attach configuration`)
	);

	volumesToAttach = volumesToAttach.filter(vol => !alreadyDetachedVolumes.has(vol.name));
	if (!volumesToAttach.length)
		return cb(Array.from(alreadyDetachedVolumes).map(vol => ({
			name: vol,
			err: `Volume ${vol} is already detached`
		})));

	getVolumesConfigurationForClient(client._id, volumesToAttach, (results, missingVolumes) => {
		missingVolumes.forEach(v => logger.sysDEBUG(`Looks like the volume ${v._id} ${v.uuid} was removed since the client report`));

		buildResponses(null, results, (clientConfigResponse, errors) => {
			const attachingVolumes = volumesToAttach.map(vol => ({
				...vol,
				attachmentsVersionRef: client.attachmentsVersion,
				referenceIDs: client.attachments[vol.uuid].referenceIDs,
				version: client.attachments[vol.uuid].version
			}));

			setAttachmentOnConfigResponses(clientConfigResponse, attachingVolumes);

			if (clientConfigResponse.length)
				sendConfigurationToClient(
					clientConfigResponse,
					client._id,
					client.topics[consts.topicSuffix.CLIENT_MAIN],
					client.attachmentsVersion,
					originID,
					AttachVolumes
				);

			cb(errors.length ? errors : null);
		});
	});
}

function deleteClient(client, callback) {
	const { _id: clientID, uuid: clientUUID } = client;
	const db = app.get('db');
	const clientCollection = db.collection('client');
	let message;
	let deletedClient;

	async.series([
		(callback) => {
			const query = {
				_id: clientID,
				uuid: clientUUID,
				client_status: { $in: [consts.clientStatus.DOWN, consts.clientStatus.INITIALIZING] },
				health: consts.targetHealth.CRITICAL
			};

			clientCollection.findOneAndDelete(query, (err, dbClient) => {
				if (err) {
					callback(new MongoError(err).log());
				} else if (!dbClient) {
					callback(new SystemMessage(systemMessages.CANT_DELETE_CLIENT));
				} else {
					deletedClient = dbClient;
					eventsModule.emitEvent([eventsModule.getClientID(clientID)], objectNotifier.events.clientRemovedEvent, dbClient);

					const dbClientWishfulStateAttachments = Object.values(dbClient.attachments || {});
					dbClientWishfulStateAttachments.forEach(attachment => {
						setVolumeReservationOnClientRemoval(clientID, attachment, (err, updatedVolume) => {
							if (err || !updatedVolume) {
								if (err)
									new MongoError(err).log();
								else
									logger.sysDEBUG(`Failed to find the volume: ${attachment.name} that attached for the deleted client ${clientID}`);
							} else {
								sendReservationModeChangeMessageToTOMAIfNeeded(updatedVolume, err => err?.log());
							}
						});
					});

					// Clean up TPV-specific state (exclusiveClient, CDV references) — fire-and-forget
					cleanupTPVReferencesForDetachedClient(clientID, dbClientWishfulStateAttachments, () => {});

					message = new SystemAdminMessage(systemMessages.CLIENT_DELETED);
					callback();
				}
			});
		},
		function deleteClientAndAgentLastMessageLog(callback) {
			lastMessageLog.deleteComponentLastMessageLog(consts.originTypes.CLIENT, clientID, deletedClient.clientToken, () => {
				lastMessageLog.deleteComponentLastMessageLog(consts.originTypes.MANAGEMENT_AGENT, clientID, deletedClient.managementAgentToken, () => {
					callback();
				});
			});
		}
	], (err) => {
		message = (err ? new SystemAdminMessage(systemMessages.CLIENT_DELETE_FAILED).addInfo(Entities.Error, err) : message)
			.addInfo(Entities.Client.ID, clientID).addInfo(Entities.Client.UUID, clientUUID);

		callback(err, message);
	});
}


scope.deleteClients = function(clients, callback) {
	const messages = [];

	async.eachSeries(clients, (client, callback) => {
		deleteClient(client, (err, message) => {
			messages.push(message);
			callback();
		});
	}, () => {
		callback(messages);
	});
};

scope.removeRestartRequired = function(clientID) {
	var db = app.get('db');
	var clientCollection = db.collection('client');

	clientCollection.findOneAndUpdate({ clientID: clientID }, { $unset: { restartRequired: 1 } }, function(err) {
		if (err)
			logger.sysDEBUG('Error removing restartRequired from client ' + clientID);

		var payload = { nodeID: clientID, restartRequired: false };
		eventsModule.emitEvent([eventsModule.getClientID(clientID)], objectNotifier.events.restartRequiredChanged, payload);
	});
};

scope.handleSnapshotVolumes = (volumes, checkSourceVolumes = false) => {
	let snapshotVolumes = {
		source: [],
		data: [],
		metadata: []
	};

	const volumeTypeToErrMsg = {
		source: 'The volume is in use a source for a snapshot.',
		data: 'The volume is a data volume for a snapshot.',
		metadata: 'The volume is a metadata volume for a snapshot.'
	};

	const getResultElement = (volumeID, volumeUUID, error) => ({ volumeID, volumeUUID, error });

	volumes.forEach(volume => {
		if (checkSourceVolumes && volume.usedAsSourceCount)
			snapshotVolumes.source.push(getResultElement(volume._id, volume.uuid, volumeTypeToErrMsg.source));
		else if (volume.snapshotID)
			snapshotVolumes.metadata.push(getResultElement(volume._id, volume.uuid, volumeTypeToErrMsg.metadata));
		else if (volume.metadataVolumeID)
			snapshotVolumes.data.push(getResultElement(volume._id, volume.uuid, volumeTypeToErrMsg.data));
	});

	return Object.values(snapshotVolumes).flat();
};

function getUpdateVolumeReservationPipeline(clientID) {
	const attachedClients = 'reservation.attachedClients';
	const reservationMode = 'reservation.mode';
	const reservationVersion = 'reservation.version';
	const reservationLastTransitionDate = 'reservation.lastTransitionDate';
	const reservedBy = 'reservation.reservedBy';
	const isAttachedClientsEmptyCond = { $eq: [{ $size: `$${attachedClients}` }, 0] };

	return [
		{
			$set: {
				[attachedClients]: {
					$filter: {
						input: `$${attachedClients}`,
						cond: { $ne: ['$$this', clientID] }
					}
				}

			}
		},
		{
			$set: {
				[reservationMode]: {
					$cond: {
						if: isAttachedClientsEmptyCond,
						then: consts.reservationModes.NONE,
						else: `$${reservationMode}`
					}
				},
				[reservationVersion]: {
					$cond: {
						if: isAttachedClientsEmptyCond,
						then: { $add: [`$${reservationVersion}`, 1] },
						else: `$${reservationVersion}`
					}
				},
				[reservationLastTransitionDate]: {
					$cond: {
						if: isAttachedClientsEmptyCond,
						then: new Date(),
						else: `$${reservationLastTransitionDate}`
					}
				},
				[reservedBy]: {
					$cond: {
						if: isAttachedClientsEmptyCond,
						then: null,
						else: `$${reservedBy}`
					}
				}
			}
		}
	];
}

scope.sendReservationModeChangeMessageToAllTargets = (volumes, cb) => {
	const volumesByZone = volumes.reduce((acc, volume) => {
		const zones = [...new Set(volume.chunks.flatMap(chunk => chunk.pRaids.map(pRaid => pRaid.zone)))];

		zones.forEach(zone => {
			acc[zone] = acc[zone] || [];
			acc[zone].push(volume);
		});

		return acc;
	}, {});

	async.each(Object.keys(volumesByZone), (zone, nextZone) => {
		utils.loadCollection('server', { filter: { zone }, projection: { node_id: 1, topics: 1, featureCompatibilityVersion: 1 } }, (err, targets) => {
			if (err)
				return nextZone(err);

			const targetsCompatibilityVersions = new Set();

			async.series([
				function sendMessages(callback) {
					async.each(targets, (target, nextTarget) => {
						targetsCompatibilityVersions.add(target.featureCompatibilityVersion);

						const reservationModeChangeMessages = volumesByZone[zone]
							.map(volume => new ReservationModeChange(volume.name, volume.uuid, volume.reservation.mode, volume.reservation.version));

						kafkaModule.sendMessages(target.topics[consts.topicSuffix.TOMA_COMMANDS], reservationModeChangeMessages, nextTarget);
					}, callback);
				},
				function updateLastReservationVersionSentToTOMA(callback) {
					const db = app.get('db');
					const volumeCollection = db.collection('volume');

					async.each(volumesByZone[zone], (volume, nextVolume) => {
						const lastReservationVersionSentToTomaByTargetVersion = Array
							.from(targetsCompatibilityVersions)
							.reduce((acc, compatibilityVersion) => { acc[compatibilityVersion] = volume.reservation.version; return acc; }, {});

						volumeCollection.updateOne(
							{ uuid: volume.uuid },
							{ $set: { lastReservationVersionSentToTomaByTargetVersion } },
							err => {
								if (err)
									new MongoError(err).log();

								nextVolume();
							});
					}, callback);
				}
			], nextZone);
		});
	}, cb);
};

// ── Per-client CDV preempt: fan-out and ACK aggregation ─────────────────────
//
// In-memory tracker for in-flight preemptClientFromCDV fan-outs. Key =
// `${cdvUUID}|${clientID}`. The durable source of truth is the EVICTING action
// on the client's attachment document in Mongo (Step 14 markEvicting); this
// tracker exists only to bridge the async Kafka fan-out / ACK loop. If the
// management instance restarts mid-preempt, the reaper (Step 14b) re-initiates
// the preempt from the EVICTING Mongo state and rebuilds this tracker; any
// late ACK arriving for a preempt that is no longer tracked is a harmless
// no-op (§2.10.4 idempotency).
const pendingPreempts = new Map();

const PREEMPT_ACK_TIMEOUT_MS = 30 * 1000;
const PREEMPT_MAX_RETRIES = 5;
const PREEMPT_BACKOFF_MS = [1000, 2000, 4000, 8000, 16000];

function preemptKey(cdvUUID, clientID) {
	return `${cdvUUID}|${clientID}`;
}

function resolvePendingPreempt(key, err) {
	const entry = pendingPreempts.get(key);
	if (!entry) return;
	pendingPreempts.delete(key);
	if (entry.timer) clearTimeout(entry.timer);
	entry.callback(err);
}

scope.sendPreemptToAllTomasOfCDV = (cdv, clientID, newFloor, cb) => {
	// Derive the set of zones serving this CDV from the CDV's chunks; pattern
	// matches sendReservationModeChangeMessageToAllTargets. A TOMA that has no
	// segments of this CDV but receives the message anyway will ACK with a
	// no-op (terminatedRegistrants=0); idempotency makes over-fan-out safe.
	const zones = [...new Set(
		(cdv.chunks || []).flatMap(chunk => (chunk.pRaids || []).map(pRaid => pRaid.zone))
	)];
	if (zones.length === 0) {
		// CDV has no chunks — nothing to fan out to. Treat as success so
		// management can proceed to cleanupDB. This case is pathological
		// (CDV with no segments) but we do not want to block the eviction.
		return cb();
	}

	const key = preemptKey(cdv.uuid, clientID);
	// If a fan-out is already in flight for this (cdv, client), wait on its
	// completion rather than starting a duplicate. This handles the reaper
	// racing an operator-initiated preempt, or two admin REST calls landing
	// concurrently. Atomic check-and-install via synchronous Map access:
	// both checking and setting a placeholder happen in this tick before
	// any await/async boundary, closing the TOCTOU window.
	const existing = pendingPreempts.get(key);
	if (existing) {
		const prev = existing.callback;
		existing.callback = (err) => { prev(err); cb(err); };
		return;
	}
	// Synchronous placeholder install — any concurrent caller that arrives
	// after this line sees the existing entry and chains its callback.
	const entry = {
		cdv,
		clientID,
		newFloor,
		expectedTomas: null, // populated after server lookup
		ackedTomas: new Set(),
		callback: cb,
		retries: 0,
		timer: null,
	};
	pendingPreempts.set(key, entry);

	utils.loadCollection('server',
		{ filter: { zone: { $in: zones } }, projection: { node_id: 1, topics: 1 } },
		(err, targets) => {
			if (err) return resolvePendingPreempt(key, err);
			const targetByNode = new Map(targets.map(t => [t.node_id, t]));
			if (targetByNode.size === 0) return resolvePendingPreempt(key, null);

			entry.expectedTomas = new Set(targetByNode.keys());

			const publish = (toNodeIds) => {
				const msg = new PreemptClientFromCDV(
					clientID, null, cdv._id, cdv.uuid, newFloor
				);
				async.each(toNodeIds, (nodeId, nextNode) => {
					const target = targetByNode.get(nodeId);
					if (!target) return nextNode();
					kafkaModule.sendMessages(
						target.topics[consts.topicSuffix.TOMA_COMMANDS],
						[msg],
						nextNode
					);
				}, () => {});
			};

			const armTimeout = () => {
				entry.timer = setTimeout(() => {
					const missing = [...entry.expectedTomas].filter(t => !entry.ackedTomas.has(t));
					if (missing.length === 0) {
						return resolvePendingPreempt(key, null);
					}
					if (entry.retries >= PREEMPT_MAX_RETRIES) {
						return resolvePendingPreempt(key,
							new SystemMessage(systemMessages.CDV_PREEMPT_TOMA_UNRESPONSIVE)
								.addInfo(Entities.Volume.UUID, cdv.uuid)
								.addInfo(Entities.Client.ID, clientID)
								.log());
					}
					const backoff = PREEMPT_BACKOFF_MS[entry.retries] || 16000;
					entry.retries += 1;
					setTimeout(() => {
						if (!pendingPreempts.has(key)) return;
						publish(missing);
						armTimeout();
					}, backoff);
				}, PREEMPT_ACK_TIMEOUT_MS);
			};

			publish([...entry.expectedTomas]);
			armTimeout();
		});
};

// Per-client CDV preempt entry point (§2.10 / Step 14).
//
// Callable from:
//   • detachTPV force path (Step 15.1)
//   • removeAlreadyDetachedAttachments stale-client cleanup (Step 15.2)
//   • attachTPV with reservation.preempt === PREEMPT (Step 15.3)
//   • POST /clients/:id/preemptFromCDV/:cdvID admin REST (Step 16)
//   • reapEvictingAttachments on management startup / periodic tick (Step 14b)
//
// Ordering invariant (see TPV_PerClientCDVPreemption.md §2.10.3): markEvicting
// BEFORE newFloor. If management crashes between the two writes, the reaper
// observes EVICTING and resumes. The reverse order leaves no recoverable signal.
scope.preemptClientFromCDV = (cdvUUID, clientID, callback) => {
	const db = app.get('db');
	const volumeCollection = db.collection('volume');
	const clientCollection = db.collection('client');
	let cdv, newFloor;

	async.series([
		function loadCDV(cb) {
			volumeCollection.findOne(
				{ uuid: cdvUUID, volumeClass: consts.volumeClass.CDV },
				(err, doc) => {
					if (err) return cb(new MongoError(err).log());
					if (!doc) return cb(new SystemMessage(systemMessages.VOLUME_NOT_FOUND).addInfo(Entities.Volume.UUID, cdvUUID));
					cdv = doc;
					cb();
				}
			);
		},
		// Step 1 of Step 14 — mark EVICTING FIRST.
		// attachments is a UUID-keyed object; use the '.${uuid}.action' path
		// pattern matching lines 1160, 3146.
		function markEvicting(cb) {
			clientCollection.updateOne(
				{ _id: clientID, [`attachments.${cdv.uuid}`]: { $exists: true } },
				{ $set: { [`attachments.${cdv.uuid}.action`]: consts.volumeAttachmentActions.EVICTING } },
				err => {
					if (err) return cb(new MongoError(err).log());
					// matchedCount == 0 is fine — attachment may have been removed
					// by a concurrent stale-client cleanup; the preempt is still
					// safe to proceed (TOMA handler is idempotent on missing
					// reg_ctx, cleanupDB is a no-op on missing attachment).
					cb();
				}
			);
		},
		// Step 2 — bump floor via $max (monotonic, idempotent on retry).
		function bumpFloor(cb) {
			newFloor = ((cdv.cdvConfig && cdv.cdvConfig.admissionFloor) || 0) + 1;
			volumeCollection.updateOne(
				{ uuid: cdvUUID },
				{ $max: { 'cdvConfig.admissionFloor': newFloor } },
				err => {
					if (err) return cb(new MongoError(err).log());
					// Reload cdv so the fan-out picks up the latest floor; an
					// earlier reaper bump via $max may have set a higher value.
					volumeCollection.findOne({ uuid: cdvUUID }, (err2, doc) => {
						if (err2) return cb(new MongoError(err2).log());
						if (doc && doc.cdvConfig && doc.cdvConfig.admissionFloor > newFloor) {
							newFloor = doc.cdvConfig.admissionFloor;
						}
						cdv = doc || cdv;
						cb();
					});
				}
			);
		},
		// Step 3 — fan out to every TOMA, wait for ACKs with retry/backoff.
		function fanOut(cb) {
			scope.sendPreemptToAllTomasOfCDV(cdv, clientID, newFloor, cb);
		},
		// Step 4 — DB cleanup once all ACKs land: remove the (client, CDV)
		// attachment entry and clear tpvConfig.exclusiveClient on every TPV
		// the client held on this CDV.
		function cleanupDB(cb) {
			scope.clearEvictedClientState(cdv, clientID, cb);
		},
	], callback);
};

// Remove the (client, CDV) attachment entry, strip tpv:* references, and
// clear tpvConfig.exclusiveClient on every TPV the client held on this CDV.
scope.clearEvictedClientState = (cdv, clientID, callback) => {
	const db = app.get('db');
	const volumeCollection = db.collection('volume');
	const clientCollection = db.collection('client');

	async.series([
		function clearExclusiveClient(cb) {
			volumeCollection.updateMany(
				{
					'tpvConfig.cdvUUID': cdv.uuid,
					'tpvConfig.exclusiveClient': clientID,
					volumeClass: consts.volumeClass.TPV,
				},
				{
					$set: {
						'tpvConfig.exclusiveClient': null,
						'tpvConfig.exclusiveClientUUID': null,
					},
				},
				err => {
					if (err) new MongoError(err).log();
					cb();
				}
			);
		},
		function removeAttachment(cb) {
			// attachments is a UUID-keyed object — remove via $unset on the
			// full path. Matches the pattern at lines 1154, 3126.
			clientCollection.updateOne(
				{ _id: clientID },
				{ $unset: { [`attachments.${cdv.uuid}`]: 1 } },
				err => {
					if (err) new MongoError(err).log();
					cb();
				}
			);
		},
	], callback);
};

// Step 14b — reaper for stuck EVICTING attachments.
//
// Scans client attachments for action === 'evicting' and resumes each via
// preemptClientFromCDV. Every downstream step is idempotent:
//   • $max floor bump is a no-op if floor already >= newFloor
//   • TOMA handler uses max_t and second terminate pass finds no reg_ctx
//   • clearEvictedClientState is a no-op if the attachment is already gone
//
// Called from bootstrapper on startup and on a periodic timer; see Step 14b.
scope.reapEvictingAttachments = (cb) => {
	const db = app.get('db');
	const clientCollection = db.collection('client');
	const volumeCollection = db.collection('volume');

	// attachments is a UUID-keyed object. Use $expr + $objectToArray to find
	// clients whose attachments object contains ANY value with action==EVICTING.
	clientCollection.find(
		{ $expr: { $anyElementTrue: { $map: {
			input: { $ifNull: [{ $objectToArray: '$attachments' }, []] },
			as: 'a',
			in: { $eq: ['$$a.v.action', consts.volumeAttachmentActions.EVICTING] },
		} } } },
		{ projection: { _id: 1, attachments: 1 } }
	).toArray((err, clients) => {
		if (err) {
			new MongoError(err).log();
			return cb && cb(err);
		}
		async.eachSeries(clients || [], (client, nextClient) => {
			// attachments object values have { uuid, action, ... }; collect the
			// uuids of entries whose action is EVICTING.
			const evictingUUIDs = Object.keys(client.attachments || {}).filter(uuid =>
				client.attachments[uuid] &&
				client.attachments[uuid].action === consts.volumeAttachmentActions.EVICTING
			);
			async.eachSeries(evictingUUIDs, (cdvUUID, nextAttach) => {
				// Confirm the attachment's volume is a CDV (skip any stray
				// EVICTING action on a non-CDV volume — defensive).
				volumeCollection.findOne(
					{ uuid: cdvUUID, volumeClass: consts.volumeClass.CDV },
					{ projection: { uuid: 1 } },
					(err2, cdv) => {
						if (err2 || !cdv) return nextAttach();
						scope.preemptClientFromCDV(cdv.uuid, client._id, () => nextAttach());
					}
				);
			}, nextClient);
		}, cb || (() => {}));
	});
};

scope.handlePreemptClientFromCDVResponse = (message, callback) => {
	const parsed = PreemptClientFromCDVResponse.parse(message.payload || message);
	const key = preemptKey(parsed.cdvUUID, parsed.clientID);
	const entry = pendingPreempts.get(key);
	if (!entry) {
		// Late ACK for a preempt we are no longer tracking (restart, duplicate,
		// etc.). Harmless: the Mongo EVICTING state is the authoritative record.
		return callback();
	}
	// Match ACK to the newFloor we fanned out; late ACK for an older floor is
	// ignored. Idempotent: multiple ACKs from the same TOMA for the same floor
	// are coalesced by the Set.
	if (parsed.newFloor !== entry.newFloor) return callback();
	if (parsed.tomaID) entry.ackedTomas.add(parsed.tomaID);
	// expectedTomas is still null in the very early window between the
	// placeholder install in sendPreemptToAllTomasOfCDV and loadCollection
	// completion. An ACK can't actually arrive in that window (nothing has
	// been published yet), but guard defensively so a stale replayed ACK
	// from a prior publication can't trip the all-acked check.
	if (!entry.expectedTomas) return callback();
	const allAcked = [...entry.expectedTomas].every(t => entry.ackedTomas.has(t));
	if (allAcked) resolvePendingPreempt(key, null);
	callback();
};

scope.getDetachUpdateForAttachment = (detachment, referenceID) => {
	const pathToAttachment = `attachments.${detachment.uuid}`;

	return {
		setDetachments: {
			[`${pathToAttachment}.action`]: {
				$cond: [
					{ $eq: [{ $size: `$${pathToAttachment}.referenceIDs` }, 0] },
					consts.volumeAttachmentActions.DETACHING,
					consts.volumeAttachmentActions.ATTACHING
				]
			},
			[`${pathToAttachment}.force`]: detachment.force,
			[`${pathToAttachment}.attachmentsVersion`]: '$attachmentsVersion'
		},
		unsetPendingDetachments: [`${pathToAttachment}.pending`],
		filterDetachedReferenceID: {
			[`${pathToAttachment}.referenceIDs`]: {
				$filter: {
					input: `$${pathToAttachment}.referenceIDs`,
					as: 'referenceID',
					cond: { $ne: ['$$referenceID', referenceID] }
				}
			}
		},
		incDetachmentVersion: { [`${pathToAttachment}.version`]: { $add: [`$${pathToAttachment}.version`, 1] } }
	};
};

function updateDetachAttachment(attachment, requestedRefID) {
	const updatedReferenceIDs = attachment.referenceIDs.filter(id => id !== requestedRefID);
	attachment.referenceIDs = updatedReferenceIDs;
	attachment.version++;
}

scope.detachVolumes = (clientID, clientUUID, requestedVolumes, callback, isSnapshotDetach) => {
	const db = app.get('db');
	const clientCollection = db.collection('client');
	const volumeCollection = db.collection('volume');

	let messages = [];
	let dbClient, originalAttachment;
	let shouldSendDetachMessage;
	let clonedVolumes = utils.extend(true, [], requestedVolumes);
	let alreadyPendingAttachments = [];
	let requestedVolumesWithRefIdRemoved = {};

	const requestedVolumesWithRefID = requestedVolumes.filter(volume => volume.referenceID);
	requestedVolumes = requestedVolumes.map(setVolumeReferenceID);

	function handleErrorForAllVolumes(volumes, systemMessage) {
		const message = systemMessage instanceof SystemMessage ? systemMessage.systemMessage : systemMessage;
		const error = systemMessage instanceof SystemMessage && systemMessage.getAdditionalInfoByKey(Entities.Error);
		volumes.forEach(volume => handleVolumeError(message, volume, error));
	}

	function handleVolumeError(systemMessage, volume, causedByError) {
		let message = new SystemAdminMessage(systemMessage)
			.addInfo(Entities.Volume.ID, volume.name)
			.addInfo(Entities.Volume.UUID, volume.uuid)
			.addInfo(Entities.Client.ID, clientID)
			.addInfo(Entities.Volume.referenceID, volume.referenceID);

		if (causedByError)
			message.addInfo(Entities.Error, causedByError);

		messages.push(message);
	}

	function handleFailedVolumes(failedVolumes, sysMsg) {
		let isAllVolumesFailed = false;

		if (failedVolumes.length) {
			isAllVolumesFailed = failedVolumes.length === requestedVolumes.length;

			if (isAllVolumesFailed) {
				handleErrorForAllVolumes(requestedVolumes, sysMsg);
			} else {
				failedVolumes.forEach(volume => handleVolumeError(sysMsg, volume));

				const failedVolumesUUIDs = failedVolumes.map(v => v.uuid);
				requestedVolumes = requestedVolumes.filter(volume => !failedVolumesUUIDs.includes(volume.uuid));
			}

			failedVolumes.forEach(volume => clearPendingWishfulStateForFailedDetachment(clientID, volume.uuid, ()=>{}));
		}

		return isAllVolumesFailed;
	}

	async.series([
		function updateOnlyRefIdIfPossible(cb) {
			if (!requestedVolumesWithRefID.length)
				return cb();

			async.waterfall([
				function tryToUpdateRefID(next) {
					const removeRefIDsPipeline = getRemoveRefIDsPipeline(requestedVolumesWithRefID);

					clientCollection.findOneAndUpdate(
						{
							_id: clientID,
							$and: requestedVolumesWithRefID.map(volume => ({ [`attachments.${volume.uuid}`]: { $exists: true } }))
						},
						removeRefIDsPipeline,
						{ returnDocument: consts.mongoReturnDocument.BEFORE },
						(err, originalClient) => {
							if (err || !originalClient) {
								if (!err) {
									err = systemMessages.DETACH_CLIENT_NOT_FOUND_OR_VOLUME_NOT_ATTACHED;
								} else {
									err = new MongoError(err);
									err.log();
								}

								handleErrorForAllVolumes(requestedVolumesWithRefID, err);
								return callback(messages);
							}

							let attachmentsWithRemovedRefID = [];
							let attachmentsWithMissingRefId = [];

							requestedVolumesWithRefID.forEach(volume => {
								const refIDs = originalClient?.attachments?.[volume.uuid]?.referenceIDs ?? [];
								const isRefIDsExist = refIDs.includes(volume.referenceID);

								if (!isRefIDsExist)
									attachmentsWithMissingRefId.push(volume);
								else if (refIDs.length > 1)
									requestedVolumesWithRefIdRemoved[volume.uuid] = volume;
							});

							const shouldExit = handleFailedVolumes(attachmentsWithMissingRefId, systemMessages.MISSING_REF_ID);
							if (shouldExit)
								return callback(messages);

							Object.values(requestedVolumesWithRefIdRemoved).forEach(({ referenceID, name, uuid }) => {
								logger.sysDEBUG(`Removed referenceID ${referenceID} from attachment ${name} ${uuid} on client ${clientID}`);
								const originalAttachment = originalClient.attachments[uuid];
								updateDetachAttachment(originalAttachment, referenceID);
								attachmentsWithRemovedRefID.push(originalAttachment);
							});

							requestedVolumes = requestedVolumes.filter(({ uuid }) => !requestedVolumesWithRefIdRemoved[uuid]);

							dbClient = originalClient;
							next(null, attachmentsWithRemovedRefID);
						}
					);
				},
				function sendUpdateRefIdMessageToClient(attachmentsWithRemovedRefID, next) {
					if (!attachmentsWithRemovedRefID.length)
						return next();

					async.each(attachmentsWithRemovedRefID, (attachment, nextAttachment) => {
						dbClient.attachmentsVersion++;
						sendUpdateReferenceIDsToClient(dbClient, attachment, dbClient.clientOriginID, err => {
							if (err)
								err.log();

							messages.push(new SystemAdminMessage(systemMessages.VOLUME_REMOVED_REF_ID)
								.addInfo(Entities.Volume.ID, attachment.name)
								.addInfo(Entities.Volume.UUID, attachment.uuid)
								.addInfo(Entities.Volume.referenceID, requestedVolumesWithRefIdRemoved[attachment.uuid].referenceID)
								.addInfo(Entities.Client.ID, clientID));

							nextAttachment();
						});
					}, next);
				}
			], () => {
				const shouldExit = !requestedVolumes.length || null;
				cb(shouldExit);
			}
			);
		},
		function verifySnapshots(cb) {
			const projectionForSnapshots = { usedAsSourceCount: 1, snapshotID: 1, metadataVolumeID: 1 };

			volumeCollection.find({ _id: { $in: requestedVolumes.map(v => v.name) } }, { projection: projectionForSnapshots })
				.toArray((err, results) => {
					if (err) {
						new MongoError(err).log();
						handleErrorForAllVolumes(requestedVolumes, systemMessages.DETACH_VOLUME_GENERAL_ERROR);
						return callback(messages);
					}

					const excludedVolumes = isSnapshotDetach ? [] : scope.handleSnapshotVolumes(results);

					if (excludedVolumes.length)
						excludedVolumes.forEach(excludedVolume => messages.push(new SystemAdminMessage(systemMessages.DETACH_VOLUME_HANDLE_SNAPSHOT_ERROR)
							.addInfo(Entities.Volume.ID, excludedVolume.volumeID)
							.addInfo(Entities.Volume.UUID, excludedVolume.volumeUUID)
							.addInfo(Entities.Client.ID, clientID)
							.addInfo(Entities.Error, excludedVolume.error))
						);

					requestedVolumes = requestedVolumes.filter(volume => !excludedVolumes.some(excludedVolume => excludedVolume.volumeID === volume.name));

					cb();
				});
		},
		function updateClientWithPendingAttachments(cb) {
			const attachments = requestedVolumes.map(volume => {
				return {
					uuid: volume.uuid,
					pending: {
						action: consts.volumeAttachmentActions.DETACHING,
						referenceID: volume.referenceID,
						handledBy: utils.getHandlingMgmtParams()
					 }
				};
			});
			const attachmentsUpdatePipeline = getUpdatePendingAttachmentsPipeline(attachments);
			const projection = { attachments: 1 };
			clientCollection.findOneAndUpdate(
				{ _id: clientID },
				attachmentsUpdatePipeline,
				{ returnDocument: consts.mongoReturnDocument.BEFORE, projection: projection },
				(err, originalClient) => {
					let sysErr;
					if (err) {
						logger.sysERROR(new MongoError(err));
						sysErr = systemMessages.DETACH_VOLUME_UPDATE_ERROR;
					} else if (!originalClient) {
						sysErr = systemMessages.CLIENT_NOT_FOUND;
					}

					if (sysErr) {
						handleErrorForAllVolumes(requestedVolumes, sysErr);
						return callback(messages);
					}

					const wishfulState = originalClient.attachments;

					let shouldExit;

					const detachedVolumes = requestedVolumes.filter(volume => !wishfulState[volume.uuid]);
					shouldExit = handleFailedVolumes(detachedVolumes, systemMessages.VOLUME_NOT_ATTACHED);
					if (shouldExit)
						return cb(true);

					const attachmentsWithoutRequestedRefID = requestedVolumes
						.filter(volume => !wishfulState[volume.uuid].referenceIDs.includes(volume.referenceID));
					shouldExit = handleFailedVolumes(attachmentsWithoutRequestedRefID, systemMessages.MISSING_REF_ID);
					if (shouldExit)
						return cb(true);

					const volumesUUIDs = requestedVolumes.map(volume => volume.uuid);
					let pendingAttachments = Object.values(wishfulState)
						.filter(attachment => volumesUUIDs.includes(attachment.uuid) && attachment.pending)
						.reduce((acc, currAttachment) => { return { ...acc, [currAttachment.uuid]: currAttachment }; }, {});

					logger.sysDEBUG(`client ${clientID}, alreadyPendingAttachments`, pendingAttachments);
					alreadyPendingAttachments = clonedVolumes.filter(volume => Object.keys(pendingAttachments).includes(volume.uuid));

					requestedVolumes = requestedVolumes.filter(volume => !Object.keys(pendingAttachments).includes(volume.uuid));

					cb();
				}
			);
		},
		function retryAlreadyPendingAttachments(cb) {
			// This is mainly relevant in sanity and recover for pending attachments.
			if (!alreadyPendingAttachments.length)
				return cb();

			waitForPendingActionRemovalAndRetry(
				clientID,
				clientUUID,
				alreadyPendingAttachments,
				handleErrorForAllVolumes,
				scope.detachVolumes,
				newMessages => {
					messages = messages.concat(newMessages);

					if (!requestedVolumes.length)
						return cb(true);

					cb();
				});
		},
		function detachEachVolume(cb) {
			async.each(requestedVolumes, function detachEachVolume(volume, nextVolume) {
				function handleSingleVolumeErrorAndContinue(systemMessage, causedByError) {
					handleVolumeError(systemMessage, volume, causedByError);
					nextVolume();
				}

				let detachment = {
					name: volume.name,
					uuid: volume.uuid,
					force: volume?.force || false
				};

				async.series([
					function updateClientWishfulState(cb) {
						let query = {
							_id: clientID,
							[`attachments.${volume.uuid}`]: { $exists: true }
						};

						const incAttachmentsVersion = { attachmentsVersion: { $add: ['$attachmentsVersion', 1] } };
						const update = scope.getDetachUpdateForAttachment(detachment, volume.referenceID);

						clientCollection.findOneAndUpdate(
							query,
							[
								{ $set: incAttachmentsVersion },
								{ $set: update.filterDetachedReferenceID },
								{ $set: update.setDetachments },
								{ $set: update.incDetachmentVersion },
								{ $unset: update.unsetPendingDetachments }
							],
							{ returnOriginal: true },
							(err, originalClient) => {
								if (err) {
									err = new MongoError(err).log();
									return handleSingleVolumeErrorAndContinue(systemMessages.DETACH_VOLUME_UPDATE_ERROR, err);
								}

								if (!originalClient)
									return handleSingleVolumeErrorAndContinue(systemMessages.DETACH_CLIENT_NOT_FOUND_OR_VOLUME_NOT_ATTACHED);

								dbClient = originalClient;
								originalAttachment = dbClient.attachments[detachment.uuid];
								updateDetachAttachment(originalAttachment, volume.referenceID);
								detachment.version = originalAttachment.version;

								shouldSendDetachMessage = !originalAttachment.referenceIDs.length;

								dbClient.attachmentsVersion++;

								if (shouldSendDetachMessage) {
									logger.sysDEBUG(`Client: ${clientID} Attachment action changed for ${detachment.name} ${detachment.uuid} `
									+ `from: ${originalAttachment.action} to ${consts.volumeAttachmentActions.DETACHING}`);

									messages.push(new SystemAdminMessage(systemMessages.VOLUME_STATE_DETACHING)
										.addInfo(Entities.Volume.ID, detachment.name)
										.addInfo(Entities.Volume.UUID, detachment.uuid)
										.addInfo(Entities.Client.ID, clientID));
								} else {
									logger.sysDEBUG(`Client: ${clientID} Attachment action for ${detachment.name} ${detachment.uuid} `
									+ `remained ${originalAttachment.action}. Removed referenceID ${volume.referenceID} from the referenceIDs set.`);

									messages.push(new SystemAdminMessage(systemMessages.VOLUME_REMOVED_REF_ID)
										.addInfo(Entities.Volume.ID, detachment.name)
										.addInfo(Entities.Volume.UUID, detachment.uuid)
										.addInfo(Entities.Volume.referenceID, volume.referenceID)
										.addInfo(Entities.Client.ID, clientID));
								}

								cb();
							}
						);
					},
					function sendMessage(cb) {
						if (shouldSendDetachMessage)
							sendDetachVolumesToClient(
								clientID,
								dbClient.topics[consts.topicSuffix.CLIENT_MAIN],
								[detachment],
								dbClient.attachmentsVersion,
								dbClient.clientOriginID,
								err => {
									if (err)
										err.log();

									cb();
								});
						else
							sendUpdateReferenceIDsToClient(dbClient, originalAttachment, dbClient.clientOriginID, err => {
								if (err)
									err.log();

								cb();
							});
					}
				], nextVolume);
			}, cb);
		},
		function removeDetachmentsAlreadyDetached(cb) {
			scope.removeAlreadyDetachedAttachments(clientID, cb);
		}
	], () => callback(messages));
};

function sendReservationModeChangeMessageToTOMAIfNeeded(dbVolume, cb) {
	const isReservationModeChangedToNone = dbVolume.reservation.mode === consts.reservationModes.NONE;

	if (!isReservationModeChangedToNone)
		return cb();

	scope.sendReservationModeChangeMessageToAllTargets([dbVolume], err => {
		if (err) {
			new MongoError(err).log();
			return cb(new SystemMessage(systemMessages.FAILED_GET_TARGETS));
		}

		cb();
	});
}

function sendDetachVolumesToClient(clientID, topic, volumes, attachmentsVersion, originID, callback) {
	logger.sysDEBUG(
		`Sending a detach message for volumes ${volumes.map(v => v.name).join(', ')} of client ${clientID}, attachmentsVersion = ${attachmentsVersion} .`
	);

	const message = new DetachVolumes(
		clientID,
		attachmentsVersion,
		volumes.map(volume => (
			{
				name: volume.name,
				uuid: volume.uuid,
				force: volume.force ? '1' : '0',
				attachment_version_per_volume: volume.version
			}
		)),
		originID
	);

	kafkaModule.sendMessages(topic, [message], callback);
}

function sendUpdateReferenceIDsToClient(client, attachment, originID, callback) {
	logger.sysDEBUG(
		`Sending a update referenceIDs message to ${client.clientID} attachmentsVersion: ${client.attachmentsVersion} attachment: ${JSON.stringify(attachment)}`
	);

	const message = new UpdateReferenceIDs(
		attachment.referenceIDs,
		attachment.uuid,
		attachment.name,
		client.attachmentsVersion,
		attachment.version,
		originID
	);

	kafkaModule.sendMessages(client.topics[consts.topicSuffix.CLIENT_MAIN], [message], callback);
}

scope.getClientConfigurationByVolumes = function(volumeReservationResult, cb, clientsGetConfUUID) {
	var id = clientsGetConfUUID ? clientsGetConfUUID + '.getClientConfigurationByVolumes' : 'getClientConfigurationByVolumes';
	var executionTimer = new ExecutionTimer(id);
	var attachedVolumes = volumeReservationResult.map(function(v) { return { uuid: v.uuid, name: v.name }; });

	var volumesTimerID = clientsGetConfUUID
		? clientsGetConfUUID + '.getClientConfigurationByVolumes.getVolumes'
		: 'getClientConfigurationByVolumes.getVolumes';
	var volumesTimer = new ExecutionTimer(volumesTimerID);
	var query = {
		filter: { $and: [
			{ $or: attachedVolumes.map(v => ({ $and: [{ _id: v.name }, { uuid: v.uuid }] })) },
			{
				$and: [
					{
						status: { $nin: [
							consts.volumeStatuses.PENDING,
							consts.volumeStatuses.TO_BE_DELETED
						] }
					},
					{
						action: { $ne: consts.volumeActions.MARKED_FOR_DELETION }
					},
					{
						isReserved: { $ne: true }
					}
				]
			}
		] },
		skip: 0,
		limit: 0,
		projection: utils.volumeProjection
	};

	utils.loadCollection('volume', query, function(err, results) {
		if (err)
			return cb(new MongoError(err));

		var volumeResultByUUID = {};
		var errors = [];
		if (results.length < attachedVolumes.length) {
			volumeReservationResult.forEach(function(volResResult) {
				if (!results.filter(function(v) { return v.name == volResResult.name || v.uuid == volResResult.uuid; }).length) {
					let err = {
						name: volResResult.name,
						uuid: volResResult.uuid,
						err: `No volume definition for: ${volResResult.name}, uuid: ${volResResult.uuid}`
					};
					volumeResultByUUID[volResResult.uuid] = err;
					errors.push(err);
				} else
					volumeResultByUUID[volResResult.uuid] = volResResult;
			});
		}

		volumesTimer.stop();
		executionTimer.stop();
		cb(errors.length ? errors : null, results.length ? { volumes: results } : null);
	});
};

/*function getResendReservationToClientResponse(volumes, obj) {
	if (obj)
		logger.sysDEBUG('Sending updated reservation version to client: ' + obj.registrant.id);

	Object.keys(volumes).forEach(volumeID => {
		let volume = volumes[volumeID].requestObj;

		var isWeakPreemptNeeded = volume.reservation.version === 0
			&& volume.reservation.mode === consts.reservationModes.EXCLUSIVE_READ_WRITE
			&& volume.reservation.preempt !== consts.reservationModePreempts.PREEMPT;

		if (isWeakPreemptNeeded)
			volume.reservation.preempt = consts.reservationModePreempts.WEAK_PREEMPT;

		if (volumes[volumeID].result)
			volume.reservation.version = volumes[volumeID].result.reservationVersion;
	});

	return volumes;
}*/

function getConfigurationResponseWrapper(request, results) {
	return (volumesForConfiguration, cb) => {
		let clientsGetConfUUID = uuid.v1();

		if (!Array.isArray(volumesForConfiguration)) {
			logger.sysDEBUG(`Received an abnormal attach message for client, overriding with empty array. volumes: ${volumesForConfiguration}`);
			volumesForConfiguration = [];
		}

		scope.getClientConfigurationByVolumes(volumesForConfiguration, (err, conf) => {
			if (conf && conf.volumes && conf.volumes.length) {
				conf.volumes = addRequestedPreemptFlagToConfVolumes(conf.volumes, results);
				// CDV volumes must be delivered before TPV volumes so that the kernel can
				// find the parent CDV when it processes the TPV attach.
				conf.volumes.sort((a, b) =>
					(a.volumeClass === consts.volumeClass.TPV ? 1 : 0) -
					(b.volumeClass === consts.volumeClass.TPV ? 1 : 0));
			}

			cb(err, conf);
		}, clientsGetConfUUID);
	};
}

function addRequestedPreemptFlagToConfVolumes(configurationVolumes, results) {
	let volumes = [];
	configurationVolumes.forEach(curr => {
		var result = results[curr.uuid] || results[curr.name];
		curr.reservation.preempt = result.requestObj.reservation?.preempt ? result.requestObj.reservation.preempt : 0;
		volumes.push(curr);
	});

	return volumes;
}

function sendUpdateConfiguration(volumes, clients, callback) {
	if (!callback)
		callback = () => {};

	let request = { payload: {} };

	let volumeResultObj = {};
	volumes.forEach(volume => {
		volume.id = volume.name || volume.id || volume.uuid;
		volumeResultObj[volume.id] = { requestObj: volume };
	});

	const getConfigurationResponse = getConfigurationResponseWrapper(request, volumeResultObj);

	getConfigurationResponse(volumes, (getConfErr, confResponse) => {
		if (getConfErr || !confResponse)
			return callback(getConfErr);

		async.each(clients, (client, nextClient) => {
			sendConfigurationToClient(
				[confResponse],
				client.clientID,
				client.topics[consts.topicSuffix.CLIENT_MAIN],
				client.attachmentsVersion,
				client.clientOriginID,
				UpdateVolumes,
				sendConfErr => nextClient(sendConfErr)
			);
		}, err => {
			if (!err)
				volumeModule.updateVolumesForSentVersionByEntityField(volumes, 'lastVersionSentToClientViaKafka', null, callback);
			else
				callback();
		});
	});
}

/**
 * this function sends volume configuration to all the clients it attached to while bypassing the permissions and reservation mode checks
 */
scope.sendUpdateVolumesToClient = (volume, callback) => {
	if (!callback)
		callback = () => {};

	volumeModule.getAttachedClientsForVolume(volume, (err, clients) => {
		if (err) {
			logger.sysDEBUG(`sendConfigurationToClientsOnVolumeChanges: failed to fetch attached clients for volume: ${volume._id}`);
			return callback(err);
		}

		logger.sysDEBUG(`sendConfigurationToClientsOnVolumeChanges: volume: ${volume._id} attached to clients:
			${JSON.stringify(clients.map(clnt => clnt.clientID))}`);

		if (clients.length > 0)
			sendUpdateConfiguration([volume], clients, callback);
	});
};

function sendConfigurationToClient(responses, clientID, topic, attachmentsVersion, originID, messageClass, callback) {
	logger.sysDEBUG(`Sending configuration message to client: ${clientID}`, responses);
	if (!Array.isArray(responses))
		responses = [responses];

	async.each(responses, (response, eachCB) => {
		// make shallow copy so that we don't update the original object by setting AV
		let payload = { ...response };
		payload.attachmentsVersion = attachmentsVersion;

		// This will create either AttachVolumes or UpdateVolumes
		let	message = new messageClass(payload, originID);
		kafkaModule.sendMessages(topic, [message], eachCB);
	}, (err) => {
		if (callback)
			callback(err);
	});
}

function buildResponses(request, volumes, cb) {
	let responses = [];
	let errorResponses = [];
	let volumesForConfiguration = [];
	let volumesForErrorResponse = [];
	let volumesForUnauthorizedResponse = [];
	let volumesForUpdateReservationVersion = [];

	for (var key in volumes) {
		volumes[key].result.id = key;

		if (volumes[key].result.isReservationVersionOutdated)
			volumesForUpdateReservationVersion.push(volumes[key].result);
		else if (volumes[key].result.success)
			volumesForConfiguration.push(volumes[key].result);
		else if (volumes[key].result.err?.systemMessage == systemMessages.UNAUTHORIZED_ATTACH_REQUEST)
			volumesForUnauthorizedResponse.push(volumes[key].result);
		else
			volumesForErrorResponse.push(volumes[key].result);
	}

	volumeModule.validateAllVolumesHaveReservationVersion(volumesForUpdateReservationVersion,
		(validatedUpdateReservationVersionVolumes) => {
			var getConfigurationResponse = getConfigurationResponseWrapper(request, volumes);

			async.series([
				(callback) => {
					if (volumesForConfiguration.length)
						return getConfigurationResponse(volumesForConfiguration, (err, confResponse) => {
							if (Array.isArray(err))
								errorResponses = errorResponses.concat(err);

							if (confResponse)
								responses.push(confResponse);
							callback();
						});

					callback();
				},
				(callback) => {
					if (validatedUpdateReservationVersionVolumes.length)
						//getResendReservationToClientResponse(volumes, request)
						errorResponses = errorResponses.concat(validatedUpdateReservationVersionVolumes);

					if (volumesForErrorResponse.length)
						errorResponses = errorResponses.concat(volumesForErrorResponse);

					if (volumesForUnauthorizedResponse.length)
						errorResponses = errorResponses.concat(volumesForUnauthorizedResponse);

					callback();
				}
			], () => {
				cb(responses, errorResponses);
			});
		});
}

function getVolumesConfigurationForClient(clientID, volumes, callback,
	excludeNonReadyVolumes = false,
	isSnapshotAttach = false,
	shouldUpdateVolumeReservation = true) {
	let results = {};

	volumeModule.enrichVolumes(volumes, (resolvedVolumes) => {
		async.each(volumes, (volumeReq, processNextVolume) => {
			const volumeID = volumeReq._id || volumeReq.name;

			let dbVolume = resolvedVolumes.find((resolvedVolume) => resolvedVolume.uuid === volumeReq.uuid);

			const volumeUUID = volumeReq.uuid || dbVolume?.uuid;

			const addInfoToSystemMessage = (systemMessage) => systemMessage
				.addInfo(Entities.Volume.ID, volumeID)
				.addInfo(Entities.Volume.UUID, volumeUUID)
				.addInfo(Entities.Client.ID, clientID);

			if (!dbVolume) {
				let err = new SystemMessage(systemMessages.VOLUME_NOT_FOUND);
				addInfoToSystemMessage(err);
				results[volumeID] = { result: { name: volumeID, success: false, err: err } };
				return processNextVolume();
			}

			if (dbVolume.status === consts.volumeStatuses.TO_BE_DELETED || dbVolume.action === consts.volumeActions.MARKED_FOR_DELETION) {
				let err = new SystemMessage(systemMessages.VOLUME_IS_BEING_DELETED);
				addInfoToSystemMessage(err);
				results[volumeUUID] = { result: { name: volumeID, success: false, err: err } };
				return processNextVolume();
			}

			if (excludeNonReadyVolumes && !dbVolume.isReady) {
				let err = new SystemMessage(systemMessages.VOLUME_NOT_READY);
				addInfoToSystemMessage(err);
				results[volumeUUID] = { result: { name: volumeID, success: false, err: err } };
				return processNextVolume();
			}

			results[volumeUUID] = {};

			if (!isSnapshotAttach && (dbVolume.snapshotID || dbVolume.metadataVolumeID)) {
				let err = new SystemMessage(systemMessages.VOLUME_IS_PART_OF_SNAPSHOT);
				addInfoToSystemMessage(err);
				results[volumeUUID].result = { name: volumeID, success: false, err: err };
				return processNextVolume();
			}

			results[volumeUUID].requestObj = volumeReq;
			results[volumeUUID].requestObj.reservedBy = clientID;

			async.series([
				function checkPermissionsIfNeeded(cb) {
					volumeModule.checkPermission(dbVolume, clientID, (isAuthorized, authorizingVSGs, authorizingKeys, clientKeys) => {
						if (isAuthorized) {
							volumeModule.logGrantedPermission(clientID, volumeID, authorizingKeys);
							return cb();
						} else {
							const error = new SystemMessage(systemMessages.UNAUTHORIZED_ATTACH_REQUEST)
								.addInfo(Entities.Client.ID, clientID)
								.addInfo(Entities.Volume.ID, volumeID)
								.addInfo(Entities.Volume.UUID, volumeUUID);
							clientKeys.forEach(k => error.addInfo(Entities.Client.authorizedKey, k._id));

							results[volumeUUID].result = {
								success: false,
								err: error,
								uuid: volumeUUID,
								name: volumeReq.name,
								clientID: clientID,
								clientKeys: clientKeys
							};

							scope.setAttachmentUnauthorized(clientID, volumeReq.name, volumeUUID, err => {
								if (err)
									logger.sysDEBUG(`Failed to set attachment ${volumeID} ${volumeUUID} on client ${clientID} as Unauthorized`);
							});

							return processNextVolume();
						}
					});
				},
				function callValidateReservationMode(cb) {
					volumeModule.validateReservationMode(clientID, volumeReq, dbVolume, (result) => {
						if (result.err)
							addInfoToSystemMessage(result.err);

						results[volumeUUID].result = result;
						cb();
					});
				},
				function changeReservationMode(cb) {
					const isAllowedToUpdateReservation = shouldUpdateVolumeReservation && results[volumeUUID].result.success;
					if (!isAllowedToUpdateReservation)
						return cb();

					volumeModule.updateVolumeReservation(clientID, volumeReq, dbVolume, result => {
						if (result.err)
							addInfoToSystemMessage(result.err);

						results[volumeUUID].result = result;
						cb();
					});
				}
			], () => {
				processNextVolume();
			});
		}, () => {
			let missingVolumes = [];
			if (volumes.length !== Object.keys(results).length)
				volumes.forEach((v) => {
					if (!(v.uuid in results)) {
						logger.sysDEBUG(`It looks like volume ${v._id} ${v.uuid} was removed since getVolumesConfigurationForClient called`);
						missingVolumes.push(v);
					}
				});

			callback(results, missingVolumes);
		});
	});
}

function enrichAttachRequestVolume(attachVolume) {
	const functionsPipeline = [
		setVolumeReservation,
		setVolumeEmulation,
		setVolumeReferenceID
	];

	return functionsPipeline.reduce((enrichedVolume, currFunc) => currFunc(enrichedVolume), attachVolume);
}

function setVolumeReservation(volume) {
	if (!volume.reservation)
		volume.reservation = {
			version: 0,
			mode: consts.reservationModes.SHARED_READ_WRITE,
			preempt: consts.reservationModePreempts.NO_PREEMPT
		};
	else {
		volume.reservation.version = volume.reservation?.version || 0;
		volume.reservation.mode = consts.reservationModes[volume.reservation.mode];
		volume.reservation.preempt = volume.reservation.preempt ? consts.reservationModePreempts.PREEMPT : consts.reservationModePreempts.NO_PREEMPT;
	}

	return volume;
}

function setVolumeEmulation(volume) {
	if (volume.emulation)
		volume.emulation.mode = consts.emulationModes[volume.emulation.mode];

	return volume;
}

function setVolumeReferenceID(volume) {
	if (!volume.referenceID)
		volume.referenceID = volume.uuid;

	return volume;
}

function validateSnapshotVolumes(clientID, dataVolumeUUID, metadataVolumeUUID, cb) {
	const db = app.get('db');
	const clientCollection = db.collection('client');
	const snapshotVolumes = [dataVolumeUUID, metadataVolumeUUID];
	const query = {
		_id: clientID,
		$or: [
			{ block_devices: { $elemMatch: { uuid: { $in: snapshotVolumes }, vol_status: consts.volumeAttachmentStatus.ATTACHED } } },
			{ [`attachments.${dataVolumeUUID}`]: { $exists: true } },
			{ [`attachments.${metadataVolumeUUID}`]: { $exists: true } }
		]
	};
	const projection = { block_devices: 1, attachments: 1 };

	clientCollection.findOne(query, { projection: projection }, (err, clientDoc) => {
		if (err) {
			err = new MongoError(err).log();
			return cb(new SystemAdminMessage(systemMessages.SNAPSHOT_ATTACH_MONGO_ERROR)
				.addInfo(Entities.Error, err)
				.addInfo(Entities.Client.ID, clientID));
		}

		if (!clientDoc)
			return cb();

		err = '';
		let attachedBlockDevices = clientDoc.block_devices
			.filter(bd => bd.vol_status === consts.volumeAttachmentStatus.ATTACHED)
			.map(bd => bd.uuid)
			.filter(volUUID => snapshotVolumes.includes(volUUID));
		let inProgressAttachments = snapshotVolumes.filter(vol => clientDoc?.attachments[vol] && !attachedBlockDevices.includes(vol));

		if (attachedBlockDevices.length)
			err = `Client ${clientID} already attached to ${attachedBlockDevices.join(', ')}\n`;
		if (inProgressAttachments.length)
			err += `Client ${clientID} has attachments in progress ${inProgressAttachments.join(', ')}`;

		if (err)
			return cb(new SystemAdminMessage(systemMessages.CLIENT_HAS_ATTACHMENT).addInfo(Entities.Error, err).addInfo(Entities.Client.ID, clientID));

		cb();
	});
}

scope.validateSourceAttached = function(sourceVolume, clientID, cb) {
	const db = app.get('db');
	const clientCollection = db.collection('client');
	const query = { _id: clientID };
	const projection = { uuid: 1, block_devices: 1 };

	clientCollection.findOne(query, { projection: projection }, (err, clientDoc) => {
		if (err) {
			err = new MongoError(err).log();
			return cb(new SystemAdminMessage(systemMessages.VALIDATE_SOURCE_ERROR)
				.addInfo(Entities.Error, err)
				.addInfo(Entities.Client.ID, clientID));
		}

		if (!clientDoc)
			return cb(new SystemAdminMessage(systemMessages.CLIENT_NOT_FOUND).addInfo(Entities.Client.ID, clientID));

		let blockDevices = clientDoc.block_devices.filter(bd => bd.uuid === sourceVolume.uuid);

		if (!blockDevices.length)
			return cb(new SystemAdminMessage(systemMessages.SNAPSHOT_SOURCE_VOLUME_NOT_ATTACHED)
				.addInfo(Entities.Client.ID, clientID)
				.addInfo(Entities.Volume.ID, sourceVolume._id)
				.addInfo(Entities.Volume.UUID, sourceVolume.uuid));

		const blockDevice = blockDevices[0];

		if (blockDevice.vol_status !== consts.volumeAttachmentStatus.ATTACHED)
			return cb(new SystemAdminMessage(systemMessages.SNAPSHOT_SOURCE_VOLUME_ATTACHMENT_NOT_READY)
				.addInfo(Entities.Client.ID, clientID)
				.addInfo(Entities.Volume.ID, sourceVolume._id)
				.addInfo(Entities.Volume.UUID, sourceVolume.uuid)
				.addInfo(Entities.Attachment.status, consts.volumeAttachmentStatusToName[blockDevice.vol_status]));

		cb();
	});
};

function checkIsUmClient(clientID, cb) {
	const db = app.get('db');
	const clientCollection = db.collection('client');
	const query = { _id: clientID };
	const projection = { isUmClient: 1 };

	clientCollection.findOne(query, projection, (err, res) => {
		if (err)
			return cb(new MongoError(err).log());

		if (!res)
			return cb(new SystemMessage(systemMessages.CLIENT_NOT_FOUND).addInfo(Entities.Client.ID, clientID));

		if (!res.isUmClient)
			return cb(new SystemMessage(systemMessages.CLIENT_SNAPSHOTS_NOT_SUPPORTED).addInfo(Entities.Client.ID, clientID));

		cb();
	});
}

scope.attachSnapshot = (snapshot, clientID, clientUUID, callback, isRecovery = false) => {
	var volumesToAttach = [
		{
			name: snapshot.metadataVolumeID,
			uuid: snapshot.metadataVolumeUUID,
			reservation: { mode: consts.reservationModeNames.EXCLUSIVE_READ_WRITE }
		},
		{
			name: snapshot._id,
			uuid: snapshot.uuid,
			reservation: { mode: consts.reservationModeNames.EXCLUSIVE_READ_WRITE },
			...(snapshot.emulation && { emulation: snapshot.emulation })
		},
	];

	let isPastAttachStage = false;

	async.series([
		function umClientValidation(cb) {
			checkIsUmClient(clientID, (err) => {
				if (err)
					err = new SystemAdminMessage(systemMessages.CLIENT_SNAPSHOTS_NOT_SUPPORTED)
						.addInfo(Entities.Client.ID, clientID).addInfo(Entities.Volume.ID, snapshot._id);

				cb(err);
			});
		},
		function dataAndMetadataVolumesValidation(cb) {
			// make sure that data and MD volumes are not attached nor in progress of attach/detach unless it's a recovery attach-snapshot
			if (isRecovery)
				return cb();

			validateSnapshotVolumes(clientID, snapshot.uuid, snapshot.metadataVolumeUUID, cb);
		},
		function sourceVolumeValidation(cb) {
			volumeModule.fetchAndValidateSourceVolume(snapshot, function(err, sourceVolumeFromDB) {
				if (err)
					return cb(err);

				scope.validateSourceAttached(sourceVolumeFromDB, clientID, cb);
			});
		},
		function attachAllVolumes(cb) {
			logger.sysDEBUG(`attaching volumes for Snapshot ${snapshot._id} ${snapshot.uuid} on clients ${clientID}`);

			scope.attachVolumes(clientID, clientUUID, volumesToAttach, logs => {
				isPastAttachStage = true;

				var attachErrors = logs.filter(l => l.systemMessage.id !== systemMessages.VOLUME_STATE_ATTACHING.id).map(l => l.toString());
				if (attachErrors.length)
					return cb(new SystemAdminMessage(systemMessages.FAILED_TO_ATTACH_SNAPSHOT)
						.addInfo(Entities.Client.ID, clientID).addInfo(Entities.Error, attachErrors));

				cb();
			}, true);
		}
	], err => {
		const attachCallback = (errorSystemAdminMessage) => {
			if (!errorSystemAdminMessage)
				logger.sysDEBUG(`Successfully attached snapshot ${snapshot._id} to ${clientID}`);

			callback(errorSystemAdminMessage || new SystemAdminMessage(systemMessages.SNAPSHOT_STATE_ATTACHING)
				.addInfo(Entities.Client.ID, clientID)
				.addInfo(Entities.Client.UUID, clientUUID)
				.addInfo(Entities.Volume.ID, snapshot._id)
				.addInfo(Entities.Volume.metadataVolumeID, snapshot.metadataVolumeID)
				.addInfo(Entities.Volume.sourceVolumeID, snapshot.sourceVolumeID));
		};

		if (!err || isRecovery)
			attachCallback(err);
		else {
			let volumesToDetach = volumesToAttach.map(v => ({ name: v.name, uuid: v.uuid }));

			logger.sysDEBUG('Rolling back the attach snapshot', { clientID: clientID, volumesToAttach: volumesToAttach });

			attachSnapshotRollback(clientID, clientUUID, isPastAttachStage, volumesToDetach, () => attachCallback(err));
		}
	});
};

scope.detachSnapshot = (snapshot, clientID, clientUUID, callback) => {
	if (!snapshot.metadataVolumeID)
		return callback(new SystemAdminMessage(systemMessages.DETACH_FAILED_NOT_A_SNAPSHOT).addInfo(Entities.Volume.ID, snapshot._id));

	let volumesToDetach = [
		{ name: snapshot._id, uuid: snapshot.uuid },
		{ name: snapshot.metadataVolumeID, uuid: snapshot.metadataVolumeUUID }
	];

	detachSnapshotVolumes(clientID, clientUUID, volumesToDetach, errorSystemAdminMessage => {
		let systemAdminMessage = errorSystemAdminMessage || new SystemAdminMessage(systemMessages.SNAPSHOT_STATE_DETACHING);

		systemAdminMessage
			.addInfo(Entities.Client.ID, clientID)
			.addInfo(Entities.Client.UUID, clientUUID)
			.addInfo(Entities.Volume.ID, snapshot._id)
			.addInfo(Entities.Volume.UUID, snapshot.uuid)
			.addInfo(Entities.Volume.metadataVolumeID, snapshot.metadataVolumeID)
			.addInfo(Entities.Volume.UUID, snapshot.metadataVolumeUUID);

		callback(systemAdminMessage);
	});
};

function attachSnapshotRollback(clientID, clientUUID, isPastAttachStage, volumesToDetach, cb) {
	if (!isPastAttachStage) {
		cb();
	} else {
		detachSnapshotVolumes(clientID, clientUUID, volumesToDetach, cb);
	}
}

function detachSnapshotVolumes(clientID, clientUUID, volumesToDetach, cb) {
	const snapshot = volumesToDetach.filter(v => !v.name.includes(consts.MetadataVolumeEnding))[0];
	logger.sysDEBUG(`detaching volumes for snapshot ${snapshot.name} from client ${clientID}`, {
		volumesToDetach: volumesToDetach,
		clientID: clientID
	});

	scope.detachVolumes(clientID, clientUUID, volumesToDetach, logs => {
		const detachErrors = logs.filter(l => l.systemMessage.id !== systemMessages.VOLUME_STATE_DETACHING.id);

		if (detachErrors.length) {
			const err = new SystemAdminMessage(systemMessages.FAILED_TO_DETACH_SNAPSHOT)
				.addInfo(Entities.Client.ID, clientID)
				.addInfo(Entities.Error, detachErrors
					.map(l=>`${l.getAdditionalInfoByKey(Entities.Volume.ID)}: ${l.toString()}`));

			const isAlreadyDetachedError = detachErrors.filter(l => l.systemMessage.id === systemMessages.VOLUME_NOT_ATTACHED.id);

			if (detachErrors.length === isAlreadyDetachedError.length) {
				logger.sysDEBUG(`Snapshot volumes for ${snapshot.name} already detached from client ${clientID}`);
				return cb();
			}

			return cb(err);
		}

		cb();
	}, true);
}

function iterateAttachDetachOnSnapshots(clientID, clientUUID, snapshots, action, cb) {
	const messages = [];

	async.each(snapshots, (snapshot, callback) => {
		action(snapshot, clientID, clientUUID, message => {
			messages.push(message);

			callback();
		});
	}, () => cb(messages));
}

scope.attachSnapshots = (clientID, clientUUID, snapshots, cb) => {
	iterateAttachDetachOnSnapshots(clientID, clientUUID, snapshots, scope.attachSnapshot, cb);
};

scope.detachSnapshots = (clientID, clientUUID, snapshots, cb) => {
	iterateAttachDetachOnSnapshots(clientID, clientUUID, snapshots, scope.detachSnapshot, cb);
};

function getHandleErrorsAndLogs(messages, clientID, clientUUID) {
	return (volumes, systemMessage, getter = (v, field) => v[field]) => {
		volumes.forEach(volume => {
			const name = getter(volume, 'name') || getter(volume, '_id');
			const uuid = getter(volume, 'uuid');
			const err = getter(volume, 'err');

			const systemAdminMessage = systemMessage instanceof SystemMessage ?
				new SystemAdminMessage(systemMessage.systemMessage).addInfo(Entities.Error, systemMessage.getAdditionalInfoByKey(Entities.Error)) :
				new SystemAdminMessage(systemMessage);

			systemAdminMessage
				.addInfo(Entities.Client.ID, clientID)
				.addInfo(Entities.Client.UUID, clientUUID)
				.addInfo(Entities.Volume.ID, name)
				.addInfo(Entities.Volume.UUID, uuid);

			if (err)
				systemAdminMessage.addInfo(Entities.Error, err);

			messages.push(systemAdminMessage);
		});
	};
}

function clearPendingWishfulStateForFailedDetachment(clientID, failedDetachmentUUID, cb) {
	const db = app.get('db');
	const clientCollection = db.collection('client');
	const pathToAttachment = `attachments.${failedDetachmentUUID}`;

	// if attachment has 'action' then only remove pending field
	// if attachment has no action and has a pending then remove all the attachment from the wishful state object
	const $set = {
		[pathToAttachment]: {
			$cond: {
				if: {
					$and: [
						{ $ifNull: [`$${pathToAttachment}.action`, false] },
						{ $ifNull: [`$${pathToAttachment}.pending`, false] }
					]
				},
				then: `$${pathToAttachment}`,
				else: {
					$cond: {
						if: { $ifNull: [`$${pathToAttachment}.pending`, false] },
						then: '$$REMOVE',
						else: `$${pathToAttachment}`
					}
				}
			}
		}
	};

	clientCollection.updateOne(
		{ _id: clientID },
		[
			{ $set: $set },
			{ $unset: [`${pathToAttachment}.pending`] },
		],
		err => {
			if (err)
				new MongoError(err).log();

			cb();
		});
}

function clearPendingForFailedUpdateAttachmentStatus(clientID, attachmentUUID, cb) {
	const db = app.get('db');
	const clientCollection = db.collection('client');
	const pathToAttachment = `attachments.${attachmentUUID}`;
	const { managementId, bootVersion } = utils.getHandlingMgmtParams();

	clientCollection.updateOne(
		{
			_id: clientID,
			[`${pathToAttachment}.pending.action`]: consts.volumeAttachmentActions.DETACHING,
			[`${pathToAttachment}.pending.handledBy.managementId`]: managementId,
			[`${pathToAttachment}.pending.handledBy.bootVersion`]: bootVersion
		},
		[
			{ $unset: [`${pathToAttachment}.pending`] },
		],
		err => {
			if (err)
				new MongoError(err).log();

			cb();
		});
}

scope.getClearWishfulStatePendingAttachAttachmentsPipeline = (attachmentsUUID) => {
	// if attachment has an action then only remove pending field
	// if attachment has no action and has a pending then remove all the attachment from the wishful state object
	let updatePipelineStages = { $set: {}, $unset: [] };
	attachmentsUUID.forEach(attachmentUUID => {
		const pathToAttachment = `attachments.${attachmentUUID}`;

		updatePipelineStages.$set[pathToAttachment] = {
			$cond: {
				if: {
					$and: [
						{ $ifNull: [`$${pathToAttachment}.action`, false] },
						{ $ifNull: [`$${pathToAttachment}.pending`, false] }
					]
				},
				then: `$${pathToAttachment}`,
				else: {
					$cond: {
						if: { $ifNull: [`$${pathToAttachment}.pending`, false] },
						then: '$$REMOVE',
						else: `$${pathToAttachment}`
					}
				}
			}
		};

		updatePipelineStages.$unset.push(`${pathToAttachment}.pending`);
	});

	const pipeline = [
		{ $set: updatePipelineStages.$set },
		{ $unset: updatePipelineStages.$unset }
	];

	return pipeline;
};

function clearPendingWishfulStateForFailedAttachments(clientID, failedAttachments, cb) {
	const db = app.get('db');
	const clientCollection = db.collection('client');
	const attachmentsUUID = failedAttachments.map(attachment => attachment.uuid);

	const pipeline = scope.getClearWishfulStatePendingAttachAttachmentsPipeline(attachmentsUUID);

	clientCollection.updateOne({ _id: clientID }, pipeline, err => {
		if (err)
			new MongoError(err).log();

		cb();
	});
}

function clearWishfulStateForDeletedVolumes(clientID, deletedVolumes, cb) {
	const db = app.get('db');
	const clientCollection = db.collection('client');
	let $unset = {};

	deletedVolumes.forEach(v => $unset[`attachments.${v.uuid}`] = 1);

	clientCollection.updateOne({ _id: clientID }, {
		$unset: $unset,
		$inc: { attachmentsVersion: 1 }
	 }, err => {
		if (err)
			new MongoError(err).log();

		logger.sysDEBUG(`client ${clientID} clearWishfulStateForDeletedVolumes removed wishfulState for deletedVolumes: `
			+ ` ${deletedVolumes.map(v=>v.name)} and incremented attachmentsVersion`);
		cb();
	});
}

function getUpdatePendingAttachmentsPipeline(attachments) {
	let createAttachmentIfNotExist = {};
	let attachmentsUpdate = {};

	attachments.forEach(attachment => {
		const attachmentPath = `attachments.${attachment.uuid}`;
		createAttachmentIfNotExist[attachmentPath] = {
			$cond: [
				{ $eq: [{ $type: `$${attachmentPath}` }, consts.mongoTypes.MISSING] },
				{},
				`$${attachmentPath}`
			]
		};
		Object.keys(attachment).forEach(key => {
			attachmentsUpdate[`${attachmentPath}.${key}`] = {
				$cond: [
					{ $eq: [{ $type: `$${attachmentPath}.pending` }, consts.mongoTypes.MISSING] },
					attachment[key],
					`$${attachmentPath}.${key}`
				]
			};
		});
	});

	return [{ $set: createAttachmentIfNotExist }, { $set: attachmentsUpdate }];
}

function waitForPendingActionRemovalAndRetry(clientID, clientUUID, pendingAttachments, attachmentErrFunc, retryFunc, cb) {
	let messages = [];
	const backoff = new Backoff({ maxTimeout: 5000 });

	async.each(pendingAttachments, (pendingAttachment, callback) => {
		utils.waitForState(
			backoff,
			`waitForAttachmentToClearPending clientID=${clientID} attachmentUUID=${pendingAttachment.uuid}`,
			cb => checkIfAttachmentDonePending(clientID, pendingAttachment.uuid, cb),
			err => {
				if (err) {
					attachmentErrFunc(
						[pendingAttachment],
						new SystemAdminMessage(systemMessages.FAILED_WAIT_FOR_PENDING_ATTACHMENT)
							.addInfo(Entities.Error, err instanceof BackoffError ? `Timeout: ${err}` : err)
					);
					return callback();
				}

				retryFunc(clientID, clientUUID, [pendingAttachment], messagesForPending => {
					messages = messages.concat(messagesForPending);
					callback();
				});
			}
		);
	}, () => cb(messages));
}

function getPreemptedAttachmentQuery(attachmentUUID, preemptingReservationVersion) {
	const pathToAttachment = `attachments.${attachmentUUID}`;
	return {
		[pathToAttachment]: { $exists: true },
		[`${pathToAttachment}.action`]: consts.volumeAttachmentActions.ATTACHING,
		[`${pathToAttachment}.reservation.version`]: { $lt: preemptingReservationVersion }
	};
}

scope.getPreemptedClientsByAttachments = (preemptedAttachments, cb) => {
	const db = app.get('db');
	const clientCollection = db.collection('client');

	const preemptedAttachmentsUUIDs = Object.keys(preemptedAttachments);
	const query = {
		$or: Object.values(preemptedAttachments).map(attachment => getPreemptedAttachmentQuery(attachment.uuid, attachment.preemptingReservationVersion))
	};

	clientCollection.find(query, { projection: { attachments: 1 } }).toArray((err, preemptedClients) => {
		if (err) {
			new MongoError(err).log();
			preemptedClients = [];
			return cb(preemptedClients);
		}

		preemptedClients.forEach(client => {
			Object.values(client.attachments).forEach(attachment => {
				let isPreemptedAttachment = false;
				let preemptingReservationVersion;

				if (preemptedAttachmentsUUIDs.includes(attachment.uuid)) {
					preemptingReservationVersion = preemptedAttachments[attachment.uuid].preemptingReservationVersion;

					isPreemptedAttachment = attachment.action === consts.volumeAttachmentActions.ATTACHING
						&& attachment.reservation.version < preemptingReservationVersion;
				}

				if (!isPreemptedAttachment)
					delete client.attachments[attachment.uuid];
				else
					client.attachments[attachment.uuid].preemptingReservationVersion = preemptingReservationVersion;
			});
		});

		cb(preemptedClients);
	});
};

scope.detachPreemptedClients = (clientsWithAttachmentsForPotentialDetach, cb) => {
	const db = app.get('db');
	const clientCollection = db.collection('client');

	let clientsWithAttachmentsForDetach = {};

	async.series([
		function updateClientWishfulStateToDetaching(sendDetachMessagesCallback) {
			async.each(clientsWithAttachmentsForPotentialDetach, (client, nextClient) => {
				async.each(client.attachments, (attachment, nextAttachment) => {
					clientCollection.findOneAndUpdate(
						{
							_id: client._id,
							...getPreemptedAttachmentQuery(attachment.uuid, attachment.preemptingReservationVersion)
						},
						{
							$set: { [`attachments.${attachment.uuid}.action`]: consts.volumeAttachmentActions.DETACHING },
							$inc: { attachmentsVersion: 1, [`attachments.${attachment.uuid}.version`]: 1 }
						},
						(err, originalClient) => {
							if (err)
								new MongoError(err).log();

							if (!originalClient)
								logger.sysDEBUG(`Will not detach this volume from ${client._id}, probably changed reservation or action.`, attachment);
							else {
								logger.sysDEBUG(`detachPreemptedClients: volume ${attachment.name} `
									+ `(uuid:${attachment.uuid}) will be detached from ${client._id}`);
								if (!clientsWithAttachmentsForDetach[client._id])
									clientsWithAttachmentsForDetach[client._id] = [];

								attachment.version = originalClient.attachments[attachment.uuid].version + 1;
								clientsWithAttachmentsForDetach[client._id].push(attachment);
							}

							nextAttachment();
						}
					);
				}, nextClient);
			}, sendDetachMessagesCallback);
		},
		function sendDetachMessages(doneCallback) {
			clientCollection.find(
				{ _id: { $in: Object.keys(clientsWithAttachmentsForDetach) } },
				{ projection: { attachmentsVersion: 1, clientOriginID: 1, topics: 1 } })
				.toArray(
					(err, dbClients) => {
						if (err) {
							new MongoError(err).log();
							return doneCallback();
						}

						async.each(Object.keys(clientsWithAttachmentsForDetach), (clientID, nextClient) => {
							const dbClient = dbClients.filter(client => client._id === clientID)[0];
							if (!dbClient)
								return nextClient();

							const volumesToDetach = clientsWithAttachmentsForDetach[clientID];

							sendDetachVolumesToClient(
								dbClient._id,
								dbClient.topics[consts.topicSuffix.CLIENT_MAIN],
								volumesToDetach,
								dbClient.attachmentsVersion,
								dbClient.clientOriginID,
								err => {
									if (err)
										err.log();

									nextClient();
								});
						}, doneCallback);
					});
		},
		function cleanupTPVState(doneCallback) {
			// For any preempted TPVs: clear exclusiveClient and remove CDV tpv:* referenceIDs
			const allDetachedAttachments = Object.entries(clientsWithAttachmentsForDetach);
			async.each(allDetachedAttachments, ([cID, attachments], next) => {
				cleanupTPVReferencesForDetachedClient(cID, attachments, next);
			}, doneCallback);
		}
	], cb);
};

scope.getAttachUpdate = (attachingVolumes, attachmentReferenceID) => {
	let update = { setAttachments: {}, addRefIdToAttachments: {}, unsetPendingAttachments: [], incAttachedAttachmentsVersion: {} };

	attachingVolumes.forEach(attachment => {
		const pathToAttachment = `attachments.${attachment.uuid}`;
		const refID = attachmentReferenceID[attachment.uuid];

		update.setAttachments[pathToAttachment] = attachment;

		// we set this in addition, because $attachmentsVersion will only be known after the first $set pipeline
		update.setAttachments[`${pathToAttachment}.attachmentsVersion`] = '$attachmentsVersion';

		update.addRefIdToAttachments[`${pathToAttachment}.referenceIDs`] = {
			$cond: [
				{ $ifNull: [`$${pathToAttachment}.referenceIDs`, false] },
				{ $setUnion: [`$${pathToAttachment}.referenceIDs`, [refID]] },
				[refID]
			]
		};
		update.incAttachedAttachmentsVersion[`${pathToAttachment}.version`] = {
			$cond: [
				{ $ifNull: [`$${pathToAttachment}.version`, false] },
				{ $add: [`$${pathToAttachment}.version`, 1] },
				1
			]
		};

		update.unsetPendingAttachments.push(`attachments.${attachment.uuid}.pending`);
	});

	return update;
};

function getAttachmentVersionsForRefIdUpdatePipeline(predicate, pathToAttachment) {
	return [
		{
			$set: {
				[`${pathToAttachment}.version`]: {
					$cond: [
						predicate,
						{ $add: [`$${pathToAttachment}.version`, 1] },
						`$${pathToAttachment}.version`
					]
				}
			}
		},
		{
			$set: {
				attachmentsVersion: {
					$cond: [
						predicate,
						{ $add: ['$attachmentsVersion', 1] },
						'$attachmentsVersion'
					]
				}
			}
		},
		{
			$set: {
				[`${pathToAttachment}.attachmentsVersion`]: {
					$cond: [
						predicate,
						'$attachmentsVersion',
						`$${pathToAttachment}.attachmentsVersion`
					]
				}
			}
		}
	];
}

function getAddRefIDsPipeline(requestedVolumesWithRefID) {
	return requestedVolumesWithRefID
		.map(volume => {
			const pathToAttachment = `attachments.${volume.uuid}`;
			const isAttaching = { $eq: [`$${pathToAttachment}.action`, consts.volumeAttachmentActions.ATTACHING] };
			const isRefIDsExist = { $gt: [{ $size: { $ifNull: [`$${pathToAttachment}.referenceIDs`, []] } }, 0] };
			const isPendingDetaching = { $eq: [`$${pathToAttachment}.pending.action`, consts.volumeAttachmentActions.DETACHING] };

			const canAddRefID = {
				$and: [
					isAttaching,
					isRefIDsExist,
					{ $not: isPendingDetaching }
				]
			};

			if (volume.reservation) {
				const isJoiningMatchingMode = { $eq: [`$${pathToAttachment}.reservation.mode`, volume.reservation.mode] };
				canAddRefID.$and.push(isJoiningMatchingMode);
			}

			return [
				{
					$set: {
						[`${pathToAttachment}.referenceIDs`]: {
							$cond: [
								canAddRefID,
								{ $setUnion: [`$${pathToAttachment}.referenceIDs`, [volume.referenceID]] },
								`$${pathToAttachment}.referenceIDs`
							]
						}
					}
				},
				...getAttachmentVersionsForRefIdUpdatePipeline(canAddRefID, pathToAttachment)
			];
		})
		.flat();
}

function getRemoveRefIDsPipeline(requestedVolumesWithRefID) {
	return requestedVolumesWithRefID
		.map(volume => {
			const pathToAttachment = `attachments.${volume.uuid}`;
			const isLastRefID = { $eq: [{ $size: { $ifNull: [`$${pathToAttachment}.referenceIDs`, []] } }, 1] };
			const canRemoveRefID = { $not: isLastRefID };

			return [
				...getAttachmentVersionsForRefIdUpdatePipeline(canRemoveRefID, pathToAttachment),
				{
					$set: {
						[`${pathToAttachment}.referenceIDs`]: {
							$cond: [
								canRemoveRefID,
								{
									$filter: {
										input: `$${pathToAttachment}.referenceIDs`,
										as: 'referenceID',
										cond: { $ne: ['$$referenceID', volume.referenceID] }
									}
								},
								`$${pathToAttachment}.referenceIDs`
							]
						}
					}
				}
			];
		})
		.flat();
}

scope.attachVolumes = (clientID, clientUUID, requestedVolumes, callback, isSnapshotAttach = false) => {
	const db = app.get('db');
	const clientCollection = db.collection('client');

	let deletedVolumes = [];
	let deletedVolumesInBuildResponses = [];
	let attachingVolumes = [];
	let volumeConfSuccesses = [];
	let volumeConfFails = [];
	let messages = [];
	let volumeConfResults = {};
	let matchAttachmentsVersion = null;
	let shouldUpdateVolumeReservation = false;
	let clientsWithAttachmentsForPotentialDetach = [];
	let dbClient, isUMClient;
	let clonedRequestedVolumes = utils.extend(true, [], requestedVolumes);
	let alreadyPendingAttachments = [];
	let requestedVolumesWithRefIdUpdated = [];

	const handleErrorsAndLogs = getHandleErrorsAndLogs(messages, clientID, clientUUID);

	const configurationProcessing = (volumes, cb) => {
		getVolumesConfigurationForClient(clientID, volumes, (results, missingVolumes) => {
			volumeConfResults = results;
			deletedVolumes = missingVolumes;

			[volumeConfSuccesses, volumeConfFails] = utils.partition(Object.values(volumeConfResults), (vol) => vol.result.success);

			handleErrorsAndLogs(missingVolumes, systemMessages.CLIENT_ATTACH_VOLUME_NOT_FOUND);
			handleErrorsAndLogs(volumeConfFails, systemMessages.CLIENT_ATTACH_VOLUME_CONFIGURATION_ERROR, (v, field) => v.result[field]);

			if (!volumeConfSuccesses.length)
				return cb(true);

			cb();
		}, true, isSnapshotAttach, shouldUpdateVolumeReservation);
	};

	const requestedVolumesWithRefID = requestedVolumes.filter(volume => volume.referenceID && !volume?.reservation?.isDetachOthers);
	requestedVolumes = requestedVolumes.map(enrichAttachRequestVolume);

	async.series([
		function updateOnlyRefIdIfPossible(cb) {
			if (!requestedVolumesWithRefID.length)
				return cb();

			async.waterfall([
				function tryToUpdateRefID(next) {
					const addRefIDsPipeline = getAddRefIDsPipeline(requestedVolumesWithRefID);

					clientCollection.findOneAndUpdate(
						{ _id: clientID },
						addRefIDsPipeline,
						{ returnDocument: consts.mongoReturnDocument.AFTER },
						(err, updatedClient) => {
							if (err || !updatedClient) {
								if (err)
									new MongoError(err).log();

								handleErrorsAndLogs(requestedVolumesWithRefID, systemMessages.ATTACH_CLIENT_UPDATE_FAILED);
								return next(true);
							}

							let attachmentsWithUpdatedRefID = [];
							requestedVolumesWithRefIdUpdated = requestedVolumesWithRefID
								.filter(volume => (updatedClient?.attachments[volume.uuid]?.referenceIDs || []).includes(volume.referenceID));

							requestedVolumesWithRefIdUpdated.forEach(({ referenceID, name, uuid }) => {
								logger.sysDEBUG(`Added referenceID ${referenceID} to attachment ${name} ${uuid} on client ${clientID}`);
								attachmentsWithUpdatedRefID.push(updatedClient.attachments[uuid]);
							});

							let requestedVolumesWithRefIdUpdatedUUIDs = new Set([]);
							requestedVolumesWithRefIdUpdated.forEach(({ uuid }) => requestedVolumesWithRefIdUpdatedUUIDs.add(uuid));
							requestedVolumes = requestedVolumes.filter(({ uuid }) => !requestedVolumesWithRefIdUpdatedUUIDs.has(uuid));

							dbClient = updatedClient;

							next(null, attachmentsWithUpdatedRefID);
						}
					);
				},
				function sendConfigurationForUpdatedRefIdVolumes(attachmentsWithUpdatedRefID, next) {
					if (!attachmentsWithUpdatedRefID.length)
						return next();

					logger.sysDEBUG('Getting configuration for volumes in update refID only flow and sending attach message.');

					sendConfigurationToAttachVolumes(dbClient, attachmentsWithUpdatedRefID, dbClient.clientOriginID, errors => {
						if (errors) {
							messages = messages.concat(getLogsFromBuildResponsesError(errors, clientID));
						}

						next();
					});
				}
			], () => {
				const shouldExit = !requestedVolumes.length || null;
				cb(shouldExit);
			}
			);
		},
		function verifySingleSnapshotPerClient(cb) {
			// if this is a snapshot attah we allow only a single snapshot to be attached to each client
			if (!isSnapshotAttach)
				return cb();

			clientCollection.findOne({ _id: clientID, client_status: { $ne: consts.clientStatus.INITIALIZING } }, (err, lastClient) => {
				if (err)
					return cb(new MongoError(err));

				for (const attachment in lastClient.attachments) {
					if (lastClient.attachments[attachment].isSnapshot && !requestedVolumes.map(v => v.name).includes(lastClient.attachments[attachment].name)) {
						handleErrorsAndLogs(requestedVolumes, systemMessages.CLIENT_ALREADY_HAS_SNAPSHOT_ATTACHED);

						return cb(true);
					}
				}

				matchAttachmentsVersion = lastClient.attachmentsVersion;
				isUMClient = lastClient.isUmClient;
				cb();
			});
		},
		function verifyUMClientIfEmulationRequested(cb) {
			const isEmulationRequested = requestedVolumes.some(volume => volume.emulation);

			if (!isEmulationRequested)
				return cb();

			const handleErrorsOnFailure = () => {
				if (isUMClient)
					return cb();

				handleErrorsAndLogs(requestedVolumes, systemMessages.NOT_UM_CLIENT_EMULATION);

				return cb(true);
			};

			if (isUMClient === undefined)
				checkIsUmClient(clientID, err => {
					isUMClient = !err;
					handleErrorsOnFailure();
				});
			else
				handleErrorsOnFailure();
		},
		function getVolumesConfiguration(cb) {
			logger.sysDEBUG('First configuration processing in attach flow, will not update reservation.');
			configurationProcessing(requestedVolumes, cb);
		},
		function updateClientWithPendingAttachments(cb) {
			logger.sysDEBUG('First client update, setting pending attaching action.');

			const attachments = volumeConfSuccesses.map(volumeConfResult => {
				return {
					uuid: volumeConfResult.result.uuid,
					name: volumeConfResult.result.name,
					pending: {
						action: consts.volumeAttachmentActions.ATTACHING,
						reservation: volumeConfResult.requestObj.reservation,
						...(volumeConfResult.requestObj.emulation && { emulation: volumeConfResult.requestObj.emulation }),
						referenceID: volumeConfResult.requestObj.referenceID,
						handledBy: utils.getHandlingMgmtParams()
					}
				};
			});
			const attachmentsUpdatePipeline = getUpdatePendingAttachmentsPipeline(attachments);
			clientCollection.findOneAndUpdate(
				{ _id: clientID },
				attachmentsUpdatePipeline,
				{ returnDocument: consts.mongoReturnDocument.BEFORE, projection: { attachments: 1 } },
				(err, originalClient) => {
					if (err || !originalClient) {
						if (err)
							new MongoError(err).log();

						handleErrorsAndLogs(requestedVolumes, systemMessages.ATTACH_CLIENT_UPDATE_FAILED);
						return cb(true);
					}

					const volumesUUIDs = volumeConfSuccesses.map(volume => volume.result.uuid);
					let pendingAttachments = Object.values(originalClient.attachments)
						.filter(attachment => volumesUUIDs.includes(attachment.uuid) && attachment.pending)
						.reduce((acc, currAttachment) => { return { ...acc, [currAttachment.uuid]: currAttachment }; }, {});

					alreadyPendingAttachments = clonedRequestedVolumes.filter(volume => Object.keys(pendingAttachments).includes(volume.uuid));

					volumeConfSuccesses = volumeConfSuccesses.filter(volume => !Object.keys(pendingAttachments).includes(volume.result.uuid));

					cb();
				}
			);
		},
		function retryAlreadyPendingAttachments(cb) {
			if (!alreadyPendingAttachments.length)
				return cb();

			waitForPendingActionRemovalAndRetry(
				clientID,
				clientUUID,
				alreadyPendingAttachments,
				handleErrorsAndLogs,
				scope.attachVolumes,
				newMessages => {
					messages = messages.concat(newMessages);

					if (!volumeConfSuccesses.length)
						return cb(true);

					cb();
				});
		},
		function getVolumesConfigurationAndUpdateReservation(cb) {
			logger.sysDEBUG('Second configuration processing in attach flow, will update reservation if needed.');

			shouldUpdateVolumeReservation = true;
			const filteredVolumes = requestedVolumes.filter(vol => !volumeConfFails.find(v => v.result.name === vol.name));

			configurationProcessing(filteredVolumes, allVolumesHasErrors => {
				const failedAttachmentsWithPendingAction = deletedVolumes.concat(volumeConfFails.map(conf => conf.requestObj));

				if (failedAttachmentsWithPendingAction.length)
					return clearPendingWishfulStateForFailedAttachments(clientID, failedAttachmentsWithPendingAction, () => cb(allVolumesHasErrors));

				cb();
			});
		},
		function updateClientAttachments(cb) {
			logger.sysDEBUG('Second client update, setting action to attaching, increasing attachmentsVersion and removing pending actions.');

			let attachmentsReferenceID = {};
			volumeConfSuccesses.forEach(volumeConfResult => {
				let attachment = {
					uuid: volumeConfResult.result.uuid,
					name: volumeConfResult.result.name,
					action: consts.volumeAttachmentActions.ATTACHING,
					reservation: volumeConfResult.requestObj.reservation,
					...(volumeConfResult.requestObj.emulation && { emulation: volumeConfResult.requestObj.emulation }),
					...(volumeConfResult.requestObj.isHidden && { isHidden: true })
				};
				attachment.reservation.version = volumeConfResult.result.reservationVersion;

				if (isSnapshotAttach)
					attachment.isSnapshot = true;

				attachmentsReferenceID[attachment.uuid] = volumeConfResult.requestObj.referenceID;
				attachingVolumes.push(attachment);
			});

			let query = {
				_id: clientID,
				client_status: { $ne: consts.clientStatus.INITIALIZING }
			};

			if (isSnapshotAttach)
				query['attachmentsVersion'] = matchAttachmentsVersion;

			const update = scope.getAttachUpdate(attachingVolumes, attachmentsReferenceID);
			const incAttachmentsVersion = { attachmentsVersion: { $add: ['$attachmentsVersion', 1] } };

			clientCollection.findOneAndUpdate(
				query,
				[
					{ $set: incAttachmentsVersion },
					{ $set: update.setAttachments },
					{ $set: update.addRefIdToAttachments },
					{ $set: update.incAttachedAttachmentsVersion },
					{ $unset: update.unsetPendingAttachments }
				],
				{ returnOriginal: true },
				(err, originalClient) => {
					if (err || !originalClient) {
						if (err)
							new MongoError(err).log();

						handleErrorsAndLogs(attachingVolumes, systemMessages.ATTACH_CLIENT_UPDATE_FAILED);
						return cb(true);
					}

					dbClient = originalClient;
					dbClient.attachmentsVersion = (dbClient.attachmentsVersion || 0) + 1;

					attachingVolumes.forEach(attachingVolume => {
						const volumeName = attachingVolume.name;
						const volumeUUID = attachingVolume.uuid;
						let originalAttachment = dbClient.attachments[volumeUUID];

						attachingVolume.version = originalAttachment.version ? originalAttachment.version + 1 : 1;
						attachingVolume.attachmentsVersionRef = dbClient.attachmentsVersion;

						const referenceID = volumeConfResults[volumeUUID].requestObj.referenceID;
						const originalReferenceIDs = new Set(originalAttachment.referenceIDs ? originalAttachment.referenceIDs : []);
						originalReferenceIDs.add(referenceID);
						attachingVolume.referenceIDs = Array.from(originalReferenceIDs);

						if (originalAttachment.action !== consts.volumeAttachmentActions.ATTACHING)
							logger.sysDEBUG(`Client: ${clientID} Attachment action changed for ${volumeName} ${volumeUUID}`
								+ ` from: ${originalAttachment.action} to ${consts.volumeAttachmentActions.ATTACHING}`);

						const prevReservationMode = originalAttachment.reservation ? originalAttachment.reservation.mode : consts.reservationModes.NONE;
						const isReservationModeChanged = prevReservationMode !== attachingVolume.reservation.mode;
						if (isReservationModeChanged)
							logger.sysDEBUG(`Client: ${clientID} Attachment reservation changed for ${volumeName} ${volumeUUID}`
								+ `from: ${prevReservationMode} to ${attachingVolume.reservation.mode}`);
					});

					cb();
				}
			);
		},
		function prepareResponsesAndSendConfiguration(cb) {
			buildResponses(null, volumeConfResults, (configResponse, errors) => {
				setAttachmentOnConfigResponses(configResponse, attachingVolumes);
				const { _id, topics, attachmentsVersion, clientOriginID } = dbClient;

				if (clientOriginID && configResponse.length)
					sendConfigurationToClient(
						configResponse,
						_id,
						topics[consts.topicSuffix.CLIENT_MAIN],
						attachmentsVersion,
						clientOriginID,
						AttachVolumes
					);
				else if (!clientOriginID)
					logger.sysDEBUG(`skipped AttachVolume since client ${_id} is missing clientOriginID`);

				if (errors) {
					messages = messages.concat(getLogsFromBuildResponsesError(errors, clientID));
				}

				cb();
			});
		},
		function getPreemptedClients(cb) {
			const preemptedAttachments = attachingVolumes
				.filter(attachment => attachment.reservation.preempt === consts.reservationModePreempts.PREEMPT && attachment.reservation.isDetachOthers)
				.reduce((acc, currAttachment) => {
					return {
						...acc,
						[currAttachment.uuid]: {
							uuid: currAttachment.uuid,
							preemptingReservationVersion: volumeConfResults[currAttachment.uuid].result.dbVolume.reservation.version
						}
					};
				}, {});

			if (utils.isEmpty(preemptedAttachments))
				return cb();

			scope.getPreemptedClientsByAttachments(preemptedAttachments, preemptedClients => {
				clientsWithAttachmentsForPotentialDetach = preemptedClients;
				cb();
			});
		},
		function detachClients(cb) {
			if (!clientsWithAttachmentsForPotentialDetach.length)
				return cb();

			scope.detachPreemptedClients(clientsWithAttachmentsForPotentialDetach, cb);
		},
		function removeWishfulStateForMissingVolumes(cb) {
			if (!deletedVolumesInBuildResponses.length)
				return cb();

			clearWishfulStateForDeletedVolumes(clientID, deletedVolumesInBuildResponses, cb);
		}
	], () => {
		const errVolumeNames = messages.map(l => l.getAdditionalInfoByKey(Entities.Volume.ID));
		const createSuccessMsgs = (sysMsg, volumes) => volumes
			.filter(volume => !errVolumeNames.includes(volume.name || volume._id))
			.map(volume => new SystemAdminMessage(sysMsg)
				.addInfo(Entities.Client.ID, clientID)
				.addInfo(Entities.Client.UUID, clientUUID)
				.addInfo(Entities.Volume.UUID, volume.uuid)
				.addInfo(Entities.Volume.ID, volume.name || volume._id)
				.addInfo(Entities.Volume.referenceID, volume.referenceID));

		const successLogs = [
			...createSuccessMsgs(systemMessages.VOLUME_STATE_ATTACHING, requestedVolumes),
			...createSuccessMsgs(systemMessages.ADDED_REF_ID, requestedVolumesWithRefIdUpdated)
		];

		messages = messages.concat(successLogs);
		callback(messages);
	});
};

function getLogsFromBuildResponsesError(errors, clientID) {
	return errors.map(error => {
		return new SystemAdminMessage(systemMessages.BUILD_RESPONSES_ERROR)
			.addInfo(Entities.Client.ID, clientID)
			.addInfo(Entities.Volume.ID, error._id || error.name)
			.addInfo(Entities.Error, error.err || error.error);
	});
}

function createCombinedAttachment(snapshotTrio) {
	const combinedIOEnabled = Object.values(snapshotTrio).every(attachment => attachment.ioEnabled);

	const dataAttachment = snapshotTrio.data;
	const lvolStackReady = (dataAttachment.stackStatus || []).includes(consts.vbdevStackStatuses.LVOL_STACK_READY);
	const isSnapshotReady = Boolean(combinedIOEnabled && lvolStackReady);

	return {
		...dataAttachment,
		combinedIOEnabled,
		isSnapshotReady
	};
}

scope.getCombinedStatusAttachment = (client, dataAttachmentID, cb) => {
	volumeModule.getAllVolumes({ metadataVolumeID: 1, sourceID: 1 }, 0, 0, { _id: dataAttachmentID }, {}, (err, volumes) => {
		if (!volumes.length)
			return cb({});

		const dataVolume = volumes[0];
		const getAttachment = attachmentName => client.block_devices
			.find(bd => bd.vol_status !== consts.volumeAttachmentStatus.DETACHED && bd.name === attachmentName);

		const snapshotTrio = {
			data: getAttachment(dataAttachmentID),
			metadata: getAttachment(dataVolume.metadataVolumeID),
			source: getAttachment(dataVolume.sourceID)
		};

		if (!Object.values(snapshotTrio).every(attachment => attachment))
			return cb({});

		const combinedAttachment = createCombinedAttachment(snapshotTrio);
		cb(combinedAttachment);
	});
};

scope.attach = (clientID, clientUUID, requestedVolumes, options, cb) => {
	if (typeof options === 'function') { cb = options; options = {}; }
	options = options || {};
	const adminManualOperation = options.adminManualOperation === true;

	logger.sysDEBUG(`clients/attach for client: ${clientID} volumes: ${JSON.stringify(requestedVolumes)}`
		+ (adminManualOperation ? ' (adminManualOperation)' : ''));

	const db = app.get('db');
	const volumeCollection = db.collection('volume');
	const names = requestedVolumes.map(v => v.name);

	volumeCollection.find({ _id: { $in: names } }, { projection: { _id: 1, volumeClass: 1, uuid: 1 } }).toArray((err, docs) => {
		if (err) {
			return utils.executeOnVolumesAndClient(requestedVolumes, clientID, clientUUID,
				scope.attachVolumes, scope.attachSnapshots,
				(clientID, clientUUID, mdVolumes, cb) => volumeModule.mdVolumeOperationNotSupportedResponse(mdVolumes, cb), cb);
		}

		const classMap = {};
		docs.forEach(d => { classMap[d._id] = { volumeClass: d.volumeClass, uuid: d.uuid }; });

		const tpvVolumes = requestedVolumes.filter(v => classMap[v.name]?.volumeClass === consts.volumeClass.TPV);
		// Admin-manual-operation override: an admin explicitly opting into
		// manual CDV / CDV_MGMT handling routes these through the normal
		// attach/detach path instead of the auto-managed rejection. Used by
		// support/debug flows; outside of this flag, CDVs remain auto-managed
		// by the management server and CDV_MGMT satellites are attached only
		// by the elected allocator TOMA.
		const cdvVolumes = adminManualOperation ? []
			: requestedVolumes.filter(v => classMap[v.name]?.volumeClass === consts.volumeClass.CDV);
		const cdvMgmtVolumes = adminManualOperation ? []
			: requestedVolumes.filter(v => classMap[v.name]?.volumeClass === consts.volumeClass.CDV_MGMT);
		const otherVolumes = requestedVolumes.filter(v => {
			const vc = classMap[v.name]?.volumeClass;
			if (vc === consts.volumeClass.TPV) return false;
			if (adminManualOperation && (vc === consts.volumeClass.CDV || vc === consts.volumeClass.CDV_MGMT)) return true;
			return vc !== consts.volumeClass.CDV && vc !== consts.volumeClass.CDV_MGMT;
		});

		const allMessages = [];

		// CDV volumes are auto-managed; manual attach is not permitted without
		// the adminManualOperation override.
		cdvVolumes.forEach(vol => {
			allMessages.push(new SystemAdminMessage(systemMessages.BUILD_RESPONSES_ERROR)
				.addInfo(Entities.Volume.ID, vol.name)
				.addInfo(Entities.Volume.UUID, classMap[vol.name]?.uuid)
				.addInfo(Entities.Client.ID, clientID)
				.addInfo(Entities.Error, 'CDV volumes are auto-managed and cannot be attached manually (pass adminManualOperation=true to override)'));
		});

		// Allocator-satellite (CDV_MGMT) volumes are attached only by the elected
		// allocator TOMA via the internal attachSatelliteForAllocator path; manual
		// REST attach is forbidden without the adminManualOperation override.
		cdvMgmtVolumes.forEach(vol => {
			allMessages.push(new SystemAdminMessage(systemMessages.BUILD_RESPONSES_ERROR)
				.addInfo(Entities.Volume.ID, vol.name)
				.addInfo(Entities.Volume.UUID, classMap[vol.name]?.uuid)
				.addInfo(Entities.Client.ID, clientID)
				.addInfo(Entities.Error,
					'Allocator-satellite volumes are attached automatically by the elected allocator TOMA (pass adminManualOperation=true to override).'));
		});

		async.parallel([
			next => {
				if (!tpvVolumes.length) return next();
				async.each(tpvVolumes, (vol, eachCb) => {
					scope.attachTPV(clientID, clientUUID, vol.name, { syncFlush: vol.syncFlush }, attachErr => {
						const msg = attachErr
							? new SystemAdminMessage(systemMessages.BUILD_RESPONSES_ERROR)
								.addInfo(Entities.Volume.ID, vol.name)
								.addInfo(Entities.Volume.UUID, classMap[vol.name]?.uuid)
								.addInfo(Entities.Client.ID, clientID)
							: new SystemAdminMessage(systemMessages.VOLUME_STATE_ATTACHING)
								.addInfo(Entities.Volume.ID, vol.name)
								.addInfo(Entities.Volume.UUID, classMap[vol.name]?.uuid)
								.addInfo(Entities.Client.ID, clientID);
						allMessages.push(msg);
						eachCb();
					});
				}, next);
			},
			next => {
				if (!otherVolumes.length) return next();
				utils.executeOnVolumesAndClient(otherVolumes, clientID, clientUUID,
					scope.attachVolumes, scope.attachSnapshots,
					(clientID, clientUUID, mdVolumes, cb) => volumeModule.mdVolumeOperationNotSupportedResponse(mdVolumes, cb),
					msgs => { allMessages.push(...msgs); next(); }
				);
			}
		], () => cb(allMessages));
	});
};

scope.detach = (clientID, clientUUID, requestedVolumes, options, cb) => {
	if (typeof options === 'function') { cb = options; options = {}; }
	options = options || {};
	const adminManualOperation = options.adminManualOperation === true;

	logger.sysDEBUG(`clients/detach for client: ${clientID} volumes: ${JSON.stringify(requestedVolumes)}`
		+ (adminManualOperation ? ' (adminManualOperation)' : ''));

	const db = app.get('db');
	const volumeCollection = db.collection('volume');
	const names = requestedVolumes.map(v => v.name);

	volumeCollection.find({ _id: { $in: names } }, { projection: { _id: 1, volumeClass: 1, uuid: 1 } }).toArray((err, docs) => {
		if (err) {
			return utils.executeOnVolumesAndClient(requestedVolumes, clientID, clientUUID,
				scope.detachVolumes, scope.detachSnapshots,
				(clientID, clientUUID, mdVolumes, cb) => volumeModule.mdVolumeOperationNotSupportedResponse(mdVolumes, cb), cb);
		}

		const classMap = {};
		docs.forEach(d => { classMap[d._id] = { volumeClass: d.volumeClass, uuid: d.uuid }; });

		const tpvVolumes = requestedVolumes.filter(v => classMap[v.name]?.volumeClass === consts.volumeClass.TPV);
		// Admin-manual-operation override: see matching comment in scope.attach.
		const cdvVolumes = adminManualOperation ? []
			: requestedVolumes.filter(v => classMap[v.name]?.volumeClass === consts.volumeClass.CDV);
		const cdvMgmtVolumes = adminManualOperation ? []
			: requestedVolumes.filter(v => classMap[v.name]?.volumeClass === consts.volumeClass.CDV_MGMT);
		const otherVolumes = requestedVolumes.filter(v => {
			const vc = classMap[v.name]?.volumeClass;
			if (vc === consts.volumeClass.TPV) return false;
			if (adminManualOperation && (vc === consts.volumeClass.CDV || vc === consts.volumeClass.CDV_MGMT)) return true;
			return vc !== consts.volumeClass.CDV && vc !== consts.volumeClass.CDV_MGMT;
		});

		const allMessages = [];

		// CDV volumes are auto-managed; manual detach is not permitted without
		// the adminManualOperation override.
		cdvVolumes.forEach(vol => {
			allMessages.push(new SystemAdminMessage(systemMessages.DETACH_VOLUME_GENERAL_ERROR)
				.addInfo(Entities.Volume.ID, vol.name)
				.addInfo(Entities.Volume.UUID, classMap[vol.name]?.uuid)
				.addInfo(Entities.Client.ID, clientID)
				.addInfo(Entities.Error, 'CDV volumes are auto-managed and cannot be detached manually (pass adminManualOperation=true to override)'));
		});

		// Allocator-satellite (CDV_MGMT) volumes are detached only by re-election
		// preempt; manual detach forbidden without the adminManualOperation override.
		cdvMgmtVolumes.forEach(vol => {
			allMessages.push(new SystemAdminMessage(systemMessages.DETACH_VOLUME_GENERAL_ERROR)
				.addInfo(Entities.Volume.ID, vol.name)
				.addInfo(Entities.Volume.UUID, classMap[vol.name]?.uuid)
				.addInfo(Entities.Client.ID, clientID)
				.addInfo(Entities.Error,
					'Allocator-satellite volumes are detached automatically when the next allocator preempts (pass adminManualOperation=true to override).'));
		});

		// Admin-manual-operation: a CDV attached via attachTPV carries
		// referenceIDs of the form 'tpv:<tpvUUID>' (and possibly 'toma:<...>').
		// A direct detach without referenceID auto-defaults to
		// referenceID=volume.uuid, which doesn't match the stored entries and
		// trips the MISSING_REF_ID check in scope.detachVolumes.
		//
		// Split the admin-override CDV/CDV_MGMT detaches out of otherVolumes.
		// For each, read the stored referenceIDs and fire one scope.detachVolumes
		// call per refID, SERIALLY — the existing path's refID-removal logic
		// handles "middle ref → refIDs.length > 1 → keep attached" vs. "last
		// ref → full detach + DetachVolumes Kafka" correctly only when each
		// volume.uuid appears at most once per call. Sequential per-refID
		// detaches preserve that invariant and fully-detach by the last one.
		const overrideVolumes = adminManualOperation
			? otherVolumes.filter(v => {
				const vc = classMap[v.name]?.volumeClass;
				return vc === consts.volumeClass.CDV || vc === consts.volumeClass.CDV_MGMT;
			})
			: [];
		const plainOtherVolumes = otherVolumes.filter(v => !overrideVolumes.includes(v));

		const detachOverrideVolumes = (nextPhase) => {
			if (!overrideVolumes.length) return nextPhase();
			const clientCollection = db.collection('client');
			async.eachSeries(overrideVolumes, (vol, eachVol) => {
				const uuid = classMap[vol.name]?.uuid;
				if (!uuid) return eachVol();
				clientCollection.findOne(
					{ _id: clientID },
					{ projection: { [`attachments.${uuid}.referenceIDs`]: 1, uuid: 1 } },
					(err, clientDoc) => {
						if (err || !clientDoc) {
							allMessages.push(new SystemAdminMessage(systemMessages.DETACH_VOLUME_GENERAL_ERROR)
								.addInfo(Entities.Volume.ID, vol.name)
								.addInfo(Entities.Volume.UUID, uuid)
								.addInfo(Entities.Client.ID, clientID)
								.addInfo(Entities.Error, err ? String(err) : 'client not found'));
							return eachVol();
						}
						const refIDs = (clientDoc.attachments && clientDoc.attachments[uuid]
							&& clientDoc.attachments[uuid].referenceIDs) || [];
						// No stored references: fall back to the default path which
						// handles VOLUME_NOT_ATTACHED / MISSING_REF_ID reporting.
						const refsToDetach = refIDs.length ? refIDs : [null];
						async.eachSeries(refsToDetach, (refID, nextRef) => {
							const req = refID === null
								? [{ name: vol.name, uuid, force: vol.force }]
								: [{ name: vol.name, uuid, referenceID: refID, force: vol.force }];
							scope.detachVolumes(clientID, clientUUID, req, msgs => {
								if (Array.isArray(msgs)) allMessages.push(...msgs);
								nextRef();
							});
						}, eachVol);
					}
				);
			}, nextPhase);
		};

		async.parallel([
			next => {
				if (!tpvVolumes.length) return next();
				async.each(tpvVolumes, (vol, eachCb) => {
					scope.detachTPV(clientID, clientUUID, vol.name, detachErr => {
						const msg = detachErr
							? new SystemAdminMessage(systemMessages.DETACH_VOLUME_GENERAL_ERROR)
								.addInfo(Entities.Volume.ID, vol.name)
								.addInfo(Entities.Volume.UUID, classMap[vol.name]?.uuid)
								.addInfo(Entities.Client.ID, clientID)
							: new SystemAdminMessage(systemMessages.VOLUME_STATE_DETACHING)
								.addInfo(Entities.Volume.ID, vol.name)
								.addInfo(Entities.Volume.UUID, classMap[vol.name]?.uuid)
								.addInfo(Entities.Client.ID, clientID);
						allMessages.push(msg);
						eachCb();
					});
				}, next);
			},
			next => {
				if (!plainOtherVolumes.length) return next();
				utils.executeOnVolumesAndClient(plainOtherVolumes, clientID, clientUUID,
					scope.detachVolumes, scope.detachSnapshots,
					(clientID, clientUUID, mdVolumes, cb) => volumeModule.mdVolumeOperationNotSupportedResponse(mdVolumes, cb),
					msgs => { allMessages.push(...msgs); next(); }
				);
			},
			next => detachOverrideVolumes(next)
		], () => cb(allMessages));
	});
};

scope.setEmulationMode = (clientID, clientUUID, requestedVolumes, cb) => {
	logger.sysDEBUG(`clients/setEmulationMode for client: ${clientID} volumes: ${JSON.stringify(requestedVolumes)}`);

	utils.executeOnVolumesAndClient(
		requestedVolumes,
		clientID,
		clientUUID,
		scope.setEmulationModeOnAttachments,
		scope.setEmulationModeOnAttachments,
		(clientID, clientUUID, mdVolumes, cb) => volumeModule.mdVolumeOperationNotSupportedResponse(mdVolumes, cb),
		cb
	);
};

function getEmulationUpdatePipeline(volumes) {
	const isChangeEmulationAllowed = volume => ({
		$and: [
			{ $ifNull: [`$attachments.${volume.uuid}`, false] }, // Check if attachment exists
			{ $eq: [`$attachments.${volume.uuid}.action`, consts.volumeAttachmentActions.ATTACHING] } // Check if action is "attaching"
		]
	});

	const updatePipeline = volumes.map(volume => (
		{
			$set: {
				[`attachments.${volume.uuid}`]: {
					$cond: {
						if: isChangeEmulationAllowed(volume),
						then: { // Update the mode if both conditions are met
							$mergeObjects: [
								`$attachments.${volume.uuid}`,
								{
									emulation: { mode: volume.emulation.mode },
									version: { $add: [`$attachments.${volume.uuid}.version`, 1] }
								}
							]
						},
						else: `$attachments.${volume.uuid}`
					}
				}
			}
		}
	));

	return updatePipeline;
}

scope.sendUpdateVolumeEmulationMessagesToClient = (client, volumes, cb) => {
	const messages = volumes.map(vol => (
		new UpdateVolumeEmulation(
			vol.emulation,
			vol.uuid,
			vol.name,
			vol.version,
			client.attachments[vol.uuid].attachmentsVersion,
			client.clientOriginID
		)
	));

	kafkaModule.sendMessages(client.topics[consts.topicSuffix.CLIENT_MAIN], messages, cb);
};

scope.updateLastMessageSentToClient = (client, topicName, volumes, cb) => {
	const db = app.get('db');
	const clientCollection = db.collection('client');

	clientCollection.updateOne(
		{ _id: client._id },
		{
			$set: volumes.reduce((acc, currVol) => (
				{
					...acc,
					[`attachments.${currVol.uuid}.lastMessageSentToClient`]: {
						version: currVol.version,
						topic: topicName
					}
				}
			), {})
		},
		err => {
			if (err)
				new MongoError(err).log();

			cb();
		});
};

scope.setEmulationModeOnAttachments = (clientID, clientUUID, requestedVolumes, cb) => {
	const db = app.get('db');
	const clientCollection = db.collection('client');

	let messages = [];
	let missingAttachments = [];
	let notAttachingAttachments = [];
	let volumesForUpdateEmulationMessages = [];
	let originalClient;
	const handleErrorsAndLogs = getHandleErrorsAndLogs(messages, clientID);

	requestedVolumes = requestedVolumes.map(setVolumeEmulation);
	async.series([
		function updateEmulationMode(callback) {
			const pipeline = getEmulationUpdatePipeline(requestedVolumes);
			clientCollection.findOneAndUpdate(
				{ _id: clientID, isUmClient: 1 },
				pipeline,
				{
					returnDocument: consts.mongoReturnDocument.BEFORE,
					projection: { attachments: 1, clientOriginID: 1, topics: 1 }
				},
				(err, result) => {
					if (err || !result) {
						new MongoError(err).log();

						handleErrorsAndLogs(
							requestedVolumes,
							systemMessages.FAILED_UPDATE_EMULATION
						);

						return callback(true);
					}

					originalClient = result;

					callback();
				});
		},
		function sendUpdateEmulationMessages(callback) {
			requestedVolumes.forEach(reqVolume => {
				if (!originalClient.attachments[reqVolume.uuid]) {
					logger.sysDEBUG(`There is no such attachment ${reqVolume.name} ${reqVolume.uuid}`);

					missingAttachments.push(reqVolume);
				} else if (originalClient.attachments[reqVolume.uuid].action !== consts.volumeAttachmentActions.ATTACHING){
					logger.sysDEBUG(`Attachment ${reqVolume.name} ${reqVolume.uuid} in action ${originalClient.attachments[reqVolume.uuid].action}`
					+ 'and can not change emulation mode.');

					notAttachingAttachments.push(reqVolume);
				} else {
					const prevEmulationMode = originalClient.attachments[reqVolume.uuid]?.emulation?.mode;
					const isEmulationModeChanged = reqVolume.emulation.mode !== prevEmulationMode;
					const msg = isEmulationModeChanged
						? `client ${clientID} changed emulation mode on attachment ${reqVolume.name} ${reqVolume.uuid} from ` +
							`${prevEmulationMode || consts.emulationModes.NONE} to ${reqVolume.emulation.mode}`
						: `client ${clientID} already with emulation mode: ${reqVolume.emulation.mode} ` +
							`on attachment ${reqVolume.name} ${reqVolume.uuid}`;

					logger.sysDEBUG(msg);

					reqVolume.version = originalClient.attachments[reqVolume.uuid].version + 1;
					volumesForUpdateEmulationMessages.push(reqVolume);
				}
			});

			if (!volumesForUpdateEmulationMessages.length)
				return callback(true);

			scope.sendUpdateVolumeEmulationMessagesToClient(originalClient, volumesForUpdateEmulationMessages, (err) => {
				if (err) {
					handleErrorsAndLogs(volumesForUpdateEmulationMessages, systemMessages.FAILED_TO_SET_EMULATION);

					return callback(true);
				}

				const topic = originalClient.topics[consts.topicSuffix.CLIENT_MAIN];
				scope.updateLastMessageSentToClient(originalClient, topic, volumesForUpdateEmulationMessages, callback);
			});
		}
	], () => {
		handleErrorsAndLogs(missingAttachments, systemMessages.ATTACHMENT_NOT_EXISTS);
		handleErrorsAndLogs(notAttachingAttachments, systemMessages.ATTACHMENT_NOT_ATTACHING);

		const errVolumeNames = messages.map(l => l.getAdditionalInfoByKey(Entities.Volume.ID));
		const successLogs = requestedVolumes
			.filter(v => !errVolumeNames.includes(v.name || v._id))
			.map(v => new SystemAdminMessage(systemMessages.VOLUME_EMULATION_MODE_CHANGED)
				.addInfo(Entities.Client.ID, clientID)
				.addInfo(Entities.Volume.UUID, v.uuid)
				.addInfo(Entities.Volume.ID, v.name || v._id));

		cb(messages.concat(successLogs));
	});
};

function checkIfAttachmentDonePending(clientID, attachmentUUID, callback) {
	const db = app.get('db');
	const clientCollection = db.collection('client');
	const attachmentPath = `attachments.${attachmentUUID}`;
	const options = { projection: { [attachmentPath]: 1 } };

	clientCollection.findOne({ _id: clientID }, options, (err, clientDoc) => {
		if (err) {
			new MongoError(err).log();
			callback(null, false);
		}

		if (!clientDoc)
			return callback(new SystemMessage(systemMessages.CLIENT_NOT_FOUND).addInfo(Entities.Client.ID, clientID));

		logger.sysDEBUG(`checkIfAttachmentDonePending attachmentUUID ${attachmentUUID}, client:`, clientDoc);

		const success = !(clientDoc.attachments[attachmentUUID] && clientDoc.attachments[attachmentUUID].pending);

		callback(null, success);
	});
}

function checkIfBlockDevicesReachedState(clientID, volumeUUIDs, attachmentState, callback) {
	const db = app.get('db');
	const clientCollection = db.collection('client');
	const options = { projection: { uuid: 1, 'block_devices.uuid': 1, 'block_devices.vol_status': 1 } };

	clientCollection.findOne({ _id: clientID }, options, (err, clientDoc) => {
		if (err)
			return callback(new MongoError(err));

		if (!clientDoc)
			return callback(new SystemMessage(systemMessages.CLIENT_NOT_FOUND).addInfo(Entities.Client.ID, clientID));

		if (!clientDoc.block_devices)
			return callback(null, false);

		const isVolumeAttached = {
			[consts.volumeAttachmentStatus.ATTACHED]: bd => bd.vol_status === consts.volumeAttachmentStatus.ATTACHED,
			[consts.volumeAttachmentStatus.DETACHED]: bd => bd.vol_status !== consts.volumeAttachmentStatus.DETACHED
		}[attachmentState.status];

		let attachedVolumes = new Set(
			clientDoc.block_devices
				.filter(isVolumeAttached)
				.map(bd => bd.uuid)
		);

		logger.sysDEBUG(`checkIfBlockDevicesReachedStatus attachedVolumes ${[...attachedVolumes]}`);

		let success = false;
		const attachPredicate = {
			[consts.volumeAttachmentStatus.ATTACHED]: uuid => attachedVolumes.has(uuid),
			[consts.volumeAttachmentStatus.DETACHED]: uuid => !attachedVolumes.has(uuid)
		}[attachmentState.status];

		if (attachPredicate)
			success = volumeUUIDs.every(attachPredicate);
		else
			logger.sysDEBUG(`Unknown attachment status: ${attachmentState.status}`);

		callback(null, success);
	});
}

scope.waitForAttachmentToReachState = function(clientID, volumeUUIDs, attachmentState, callback) {
	const generalSettings = app.get('globalSettings');
	const timer = new ExecutionTimer('snapshots.waitForVolumesToBeAttached');
	const timeout = generalSettings.snapshotAttachTimeout;
	const backoff = new Backoff({ maxBackoff: 5000, maxTimeout: timeout });

	utils.waitForState(
		backoff,
		`waitForAttachmentToReachState clientID=${clientID} volumeUUIDs=${volumeUUIDs} expectedStatus=${JSON.stringify(attachmentState)}`,
		cb => checkIfBlockDevicesReachedState(clientID, volumeUUIDs, attachmentState, cb),
		err => { timer.stop(); callback(err); }
	);
};

scope.setAttachmentUnauthorized = function(clientID, volumeName, volumeUUID, callback) {
	var db = app.get('db');
	var clientCollection = db.collection('client');

	// make sure the attachment exists
	var query = { _id: clientID };
	query['attachments.' + volumeUUID + '.name'] = volumeName;

	// Set the action to unauthorized
	var $set = {};
	$set['attachments.' + volumeUUID + '.action'] = consts.volumeAttachmentActions.UNAUTHORIZED;
	$set['attachments.' + volumeUUID + '.nextAttemptTime'] = moment().add(5, 'minutes').toDate();
	$set['attachments.' + volumeUUID + '.lastAttemptTime'] = new Date();

	clientCollection.updateOne(query, { $set: $set }, err => {
		if (callback)
			return callback(err);
	});
};

scope.updateClientKeys = (reportedKeys, clientID, cb) => {
	var db = app.get('db');
	var keyCollection = db.collection('key');
	var clientCollection = db.collection('client');

	var uuids = reportedKeys.map((k) => { return k.uuid; });
	async.waterfall([
		function validateKeys(cb) {
			keyCollection.find({ uuid: { $in: uuids } }).project({ uuid: 1 }).toArray((err, validatedKeys) => {
				if (err)
					new MongoError(err).log();

				if (validatedKeys.length < reportedKeys.length) {
					// not all keys found in the db
					let dbKeyUUIDs = new Set();
					validatedKeys.forEach(k => dbKeyUUIDs.add(k.uuid));

					// check which were not validated and log a message
					reportedKeys.forEach(reportedKey => {
						if (!dbKeyUUIDs.has(reportedKey.uuid))
							logger.sysDEBUG(`key reported from node ${clientID} was not recognized id: ${reportedKey.name} uuid: ${reportedKey.uuid}`);
					});
				}
				cb(err, validatedKeys);
			});
		},
		function updateClientDocument(keys, cb) {
			clientCollection.findOneAndUpdate(
				{ _id: clientID },
				{ $set: { keys: keys } },
				{ returnOriginal: false },
				(err, clientDoc) => {
					if (err)
						new MongoError(err).log();

					cb(err, clientDoc);
				}
			);
		}
	], err => {
		if (cb)
			cb(err);
	});
};

scope.handleClientLogRequest = (message, callback) => {
	const systemMessage = Object.assign({}, systemMessages.EXTERNAL_LOG_MSG);

	systemMessage.message = message.payload.message;
	systemMessage.header = message.payload.header;
	systemMessage.logLevel = message.payload.level;
	systemMessage.sysLogLevel = message.payload.level;

	new SystemAdminMessage(systemMessage).setID(message.payload.id).log();

	callback();
};

scope.handleClientUpdateLogRequest = (message, completion) => {
	var payloadID = message.payload.id;
	var log = message.payload.message;
	var header = message.payload.header;
	var level = message.payload.level;

	if (payloadID && header && (log || level))
		logModule.updateLogByQuery({ 'meta.id': message.payload.id, 'meta.header': message.payload.header }, level, log);

	completion();
};

scope.handleClientAckLogRequest = (message, completion) => {
	if (message.payload.id && message.payload.header)
		logModule.acknowledgeByQuery({ 'meta.id': message.payload.id, 'meta.header': message.payload.header }, consts.SYSTEM_USER);

	completion();
};

function overrideVolumeStatusIfNeeded(blockDevice) {
	// since DETACHED_AFTER_SHUTDOWN and DETACHED values have the same meaning for the mgmt we can use DETACHED only
	if (blockDevice.vol_status === consts.volumeAttachmentStatus.DETACHED_AFTER_SHUTDOWN)
		blockDevice.vol_status = consts.volumeAttachmentStatus.DETACHED;

	// DETACHED_FAILED_UNKNOWN_VOLUME means the client is not attached to this volume, so we treat it as DETACHED
	if (blockDevice.vol_status == consts.volumeAttachmentStatus.DETACH_FAILED_UNKNOWN_VOLUME)
		blockDevice.vol_status = consts.volumeAttachmentStatus.DETACHED;
}


function shouldCalculateClientHealthOnAgentChange(dbClientHealth, newAgentStatus) {
	return !(dbClientHealth == consts.targetHealth.HEALTHY && newAgentStatus == consts.managementAgentStatuses.UP)
		&& !(dbClientHealth == consts.targetHealth.CRITICAL && newAgentStatus == consts.managementAgentStatuses.DOWN);
}

scope.setManagementAgentStatus = (clientID, status, agentToken, messageSequence, originID, shouldUpdateKeepaliveInterval, callback) => {
	const db = app.get('db');
	const clientCollection = db.collection('client');

	const query = {
		_id: clientID,
		managementAgentToken: agentToken,
		'agentKafkaMessageSequence.keepalive': { $lte: messageSequence }
	};

	const $update = {
		$set: {
			'agentKafkaMessageSequence.keepalive': messageSequence,
			managementAgentStatus: status,
		}
	};

	if (originID)
		$update.$set.agentOriginID = originID;

	if (status == consts.managementAgentStatuses.DOWN)
		$update.$inc = { managementAgentToken: 1 };

	clientCollection.findOneAndUpdate(query, $update, (err, lastAgent) => {
		if (err)
			return callback(new MongoError(err).log());

		if ($update.$inc && $update.$inc.managementAgentToken)
			utils.clearFunctionDebouncer(clientID + '_sendAgentToken');

		if (!lastAgent) {
			logger.sysDEBUG('managementAgentStatus was not saved on the client ' + clientID + ' to ' + status + ' query: ' + JSON.stringify(query));
			return resendAgentTokenIfNeeded(clientID, agentToken, originID, shouldUpdateKeepaliveInterval,
				(error, isClientExists) => callback(error, lastAgent, isClientExists));
		}

		if (lastAgent.managementAgentStatus != status)
			logger.sysDEBUG('i just updated managementAgentStatus on client ' + clientID + ' to ' + status);

		if (shouldCalculateClientHealthOnAgentChange(lastAgent.health, status))
			scope.calculateAndSaveClientHealth(clientID);

		if (shouldUpdateKeepaliveInterval)
			return resendAgentTokenIfNeeded(clientID, agentToken, originID, shouldUpdateKeepaliveInterval, error => callback(error, lastAgent, true));

		callback(null, lastAgent, true);
	});
};

function sendUpdateAgentTokenMessageWithDebouncer(clientID, topic, originID, managementAgentToken, agentKafkaMessageSequence) {
	const debouncerID = clientID + '_sendAgentToken';

	const sendUpdateAgentTokenMessageFunction = () =>
		sendUpdateAgentKeepaliveTokenMessage(clientID, topic, managementAgentToken, utils.getMaxMessageSequence(agentKafkaMessageSequence) || 1, originID);

	utils.callFunctionWithDebouncer(sendUpdateAgentTokenMessageFunction, debouncerID);
}

function increaseClientTokenFromReportedToken(dbClient, clientOriginID, reportedToken, callback) {
	const db = app.get('db');
	const clientCollection = db.collection('client');
	const clientID = dbClient._id;
	const query = { _id: clientID, clientToken: dbClient.clientToken };
	const update = { $set: { clientToken: reportedToken + 1 } };
	const projection = { clientToken: 1, uuid: 1, attachmentsVersion: 1, kafkaMessageSequence: 1, maxReportID: 1, topics: 1 };
	const options = { returnDocument: consts.mongoReturnDocument.AFTER, projection };

	clientCollection.findOneAndUpdate(query, update, options, (err, res) => {
		if (err)
			return callback(new MongoError(err).log());

		if (!res)
			return callback();

		// reset msgSequence to one after token incremented
		let kafkaMsgSeqObj = { keepalive: 1 };
		sendUpdateClientTokenMessageWithDebouncer(
			clientID,
			res.uuid,
			clientOriginID,
			res.clientToken,
			res.attachmentsVersion,
			kafkaMsgSeqObj,
			res.maxReportID,
			res.topics[consts.topicSuffix.CLIENT_MAIN]);

		callback();
	});
}

function resendClientTokenIfNeeded(clientID, reportedToken, originID, shouldUpdateKeepaliveInterval, callback) {
	const db = app.get('db');
	const clientCollection = db.collection('client');
	const projection = { clientToken: 1, uuid: 1, clientOriginID: 1, attachmentsVersion: 1, kafkaMessageSequence: 1, maxReportID: 1, topics: 1 };
	const options = { projection };

	clientCollection.findOne({ _id: clientID }, options, (err, dbClient) => {
		if (err)
			return callback(new MongoError(err).log());

		if (!dbClient) {
			logger.DEBUG(`resendClientTokenIfNeeded: ingoring since client not found. client: ${clientID} reportedToken=${reportedToken}`);
			return callback();
		}

		const clientOriginID = originID || dbClient.clientOriginID;

		if (dbClient.clientToken < reportedToken) {
			logger.DEBUG(`resendClientTokenIfNeeded: reported clientToken > dbClient.clientToken - adopting client reportedToken + 1. client: ${clientID} `
				+ `dbClient.clientToken=${dbClient.clientToken} reportedToken=${reportedToken} new clientToken: ${reportedToken + 1}`);
			return increaseClientTokenFromReportedToken(dbClient, clientOriginID, reportedToken, callback);
		}

		if (dbClient.clientToken > reportedToken || shouldUpdateKeepaliveInterval) {
			logger.DEBUG(`resendClientTokenIfNeeded: sending client token with debouncer client: ${clientID} `
				+ `dbClient.clientToken=${dbClient.clientToken} reportedToken=${reportedToken}`);
			sendUpdateClientTokenMessageWithDebouncer(
				clientID,
				dbClient.uuid,
				clientOriginID,
				dbClient.clientToken,
				dbClient.attachmentsVersion,
				dbClient.kafkaMessageSequence,
				dbClient.maxReportID,
				dbClient.topics[consts.topicSuffix.CLIENT_MAIN]);
		}

		callback();
	});
}

function increaseAgentTokenFromReportedToken(dbClient, agentOriginID, reportedToken, callback) {
	const db = app.get('db');
	const clientCollection = db.collection('client');
	const clientID = dbClient._id;
	const query = { _id: clientID, managementAgentToken: dbClient.managementAgentToken };
	const update = { $set: { managementAgentToken: reportedToken + 1 } };
	const options = { returnDocument: consts.mongoReturnDocument.AFTER, projection: { managementAgentToken: 1, agentKafkaMessageSequence: 1, topics: 1 } };

	clientCollection.findOneAndUpdate(query, update, options, (err, res) => {
		if (err)
			return callback(new MongoError(err).log());

		if (!res)
			return callback();

		sendUpdateAgentTokenMessageWithDebouncer(
			clientID,
			res.topics[consts.topicSuffix.AGENT_MAIN],
			agentOriginID,
			res.managementAgentToken,
			res.agentKafkaMessageSequence
		);
		callback();
	});
}

function resendAgentTokenIfNeeded(clientID, reportedToken, originID, shouldUpdateKeepaliveInterval, callback) {
	const db = app.get('db');
	const clientCollection = db.collection('client');
	const options = { projection: { managementAgentToken: 1, agentOriginID: 1, agentKafkaMessageSequence: 1, topics: 1 } };

	clientCollection.findOne({ _id: clientID }, options, (err, dbClient) => {
		if (err)
			return callback(new MongoError(err).log());

		if (!dbClient)
			return callback(null, false);

		const agentOriginID = originID || dbClient.agentOriginID;

		if (dbClient.clientToken < reportedToken)
			return increaseAgentTokenFromReportedToken(dbClient, agentOriginID, reportedToken, (err) => callback(err, true));

		if (dbClient.managementAgentToken > reportedToken || shouldUpdateKeepaliveInterval)
			sendUpdateAgentTokenMessageWithDebouncer(
				clientID,
				dbClient.topics[consts.topicSuffix.AGENT_MAIN],
				originID || dbClient.agentOriginID,
				dbClient.managementAgentToken,
				dbClient.agentKafkaMessageSequence
			);

		callback(null, true);
	});
}

function handleClientCompatibilityVersionChanged(clientID, newFeatureCompatibilityVersion, oldFeatureCompatibilityVersion, mgmtAgentToken, messageSequence) {
	const db = app.get('db');
	const clientCollection = db.collection('client');

	kafkaModule.getClientTopicsToCreate(newFeatureCompatibilityVersion, clientID, topics => {
		const query = {
			_id: clientID,
			managementAgentToken: mgmtAgentToken,
			'agentKafkaMessageSequence.keepalive': { $lte: messageSequence }
		};
		const $set = {
			featureCompatibilityVersion: newFeatureCompatibilityVersion,
			topics: kafkaModule.mapTopicNamesToTopicSuffix(topics.map(topic => topic.name))
		};

		clientCollection.updateOne(query, { $set }, (err, result) => {
			if (err)
				return new MongoError(err).log();

			if (result.modifiedCount)
				new SystemAdminMessage(systemMessages.COMPONENT_VERSION_CHANGED)
					.addInfo(Entities.Client.ID, clientID)
					.addInfo(Entities.Client.featureCompatibilityVersion, oldFeatureCompatibilityVersion, Differentiators.Old)
					.addInfo(Entities.Client.featureCompatibilityVersion, newFeatureCompatibilityVersion, Differentiators.New)
					.log();
		});
	});
}

function handleAgentFirstKeepAlive(msg, callback) {
	const { clientID, originID, payload: { featureCompatibilityVersion } } = msg;
	const db = app.get('db');
	const clientCollection = db.collection('client');
	const projection = { managementAgentToken: 1, agentKafkaMessageSequence: 1, featureCompatibilityVersion: 1, topics: 1 };

	clientCollection.findOne({ _id: clientID }, { projection }, (err, dbClient) => {
		if (err)
			return callback(new MongoError(err).log());

		if (!dbClient)
			return handleClientCreation(clientID, originID, featureCompatibilityVersion, 1, callback);

		const sendUpdateAgentToken = (topic) => {
			sendUpdateAgentTokenMessageWithDebouncer(
				clientID,
				topic,
				originID,
				dbClient.managementAgentToken,
				dbClient.agentKafkaMessageSequence
			);
			callback();
		};

		// old messages - can be discarded
		if (featureCompatibilityVersion < dbClient.featureCompatibilityVersion)
			return callback();

		if (featureCompatibilityVersion === dbClient.featureCompatibilityVersion)
			return sendUpdateAgentToken(dbClient.topics[consts.topicSuffix.AGENT_MAIN]);

		logger.sysDEBUG(`Client featureCompatibilityVersion changed for ${clientID}!` +
			`Before: ${dbClient.featureCompatibilityVersion}, New ${featureCompatibilityVersion}`);

		kafkaModule.createClientTopics(clientID, featureCompatibilityVersion, (err, topics) => {
			if (err)
				return callback(err);

			sendUpdateAgentToken(topics[consts.topicSuffix.AGENT_MAIN]);
		});
	});
}

function emitCanExportVolumeViaNvmfByClient(clientID) {
	var db = app.get('db');
	var clientCollection = db.collection('client');
	var volumeCollection = db.collection('volume');

	// avoid taking a lock by getting the nvmfExportID first and then the volumeIds
	clientCollection.findOne(
		{ _id: clientID },
		{ nvmfExportID: 1, nvmfAttachmentsID: 1 },
		(err, result) => {
			if (err)
				return new MongoError(err).log();

			if (!result)
				return logger.sysDEBUG('Couldn\'t find client: ' + clientID + ' in DB when trying to look for nvmfExportID');

			var nvmfExportID = result.nvmfExportID;
			var nvmfAttachmentsID = result.nvmfAttachmentsID;

			if (nvmfExportID)
				volumeCollection.find({ selectedClientsForNvmf: clientID }).project({ _id: 1, uuid: 1 }).toArray((err, volumesPayload) => {
					if (err)
						return new MongoError(err).log();

					if (volumesPayload && volumesPayload.length)
						eventsModule.emitEvent(
							[eventsModule.getClientID(clientID)],
							objectNotifier.events.canExportVolumeViaNvmfChangedEvent,
							{ volumes: volumesPayload,
								isOn: true,
								isDelta: false,
								nvmfExportID: nvmfExportID,
								nvmfAttachmentsID: nvmfAttachmentsID }
						);
				});
		}
	);
}

scope.handleAgentKeepAlive = (message, callback) => {
	if (message.mgmtAgentToken === -1)
		return handleAgentFirstKeepAlive(message, callback);

	const GLOBAL_SETTINGS = app.get('globalSettings');
	const keepaliveInterval = GLOBAL_SETTINGS.keepaliveIntervals.CLIENT;

	const { clientID, originID, mgmtAgentToken, messageSequence, payload: { featureCompatibilityVersion } } = message;
	let shouldUpdateKeepaliveInterval;

	if (message.payload.nvmfExportID === -1)
		emitCanExportVolumeViaNvmfByClient(message.clientID);

	if (keepaliveInterval !== message.keepaliveInterval) {
		logger.sysDEBUG(`Unexpected Agent keepaliveInterval, configured: ${keepaliveInterval} actual: ${message.keepaliveInterval}`);
		shouldUpdateKeepaliveInterval = true;
	}

	return scope.setManagementAgentStatus(clientID, consts.managementAgentStatuses.UP, mgmtAgentToken, messageSequence, originID, shouldUpdateKeepaliveInterval,
		(err, lastAgent, isClientExists) => {
			if (err)
				return callback(err);

			if (!isClientExists)
				return handleClientCreation(clientID, originID, featureCompatibilityVersion, mgmtAgentToken, callback);

			if (!lastAgent)
				return callback();

			if (lastAgent.featureCompatibilityVersion < featureCompatibilityVersion)
				handleClientCompatibilityVersionChanged(clientID, featureCompatibilityVersion, lastAgent.featureCompatibilityVersion,
					mgmtAgentToken, messageSequence);

			verifyConfigProfileOnAgentKeepAlive(clientID, message.payload.configProfileInfo);
			callback();
		}
	);
};

function sendUpdateAgentKeepaliveTokenMessage(clientID, topic, token, messageSequence, originID, cb) {
	const GLOBAL_SETTINGS = app.get('globalSettings');
	const keepaliveInterval = GLOBAL_SETTINGS.keepaliveIntervals.CLIENT;
	const message = new UpdateAgentToken(clientID, token, messageSequence, originID, keepaliveInterval);

	kafkaModule.sendMessages(topic, [message], cb);
}

function verifyConfigProfileOnAgentKeepAlive(nodeID, profileInfo) {
	configurationProfiles.verifyConfigProfileOnAgentKeepAlive(nodeID, profileInfo, err => {
		if (err)
			logger.sysDEBUG(`Failed to process profileInfo from node ${nodeID}`, err);
	});
}

function getNewClient(clientID, agentOriginID, featureCompatibilityVersion, managementAgentToken, topics) {
	return {
		_id: clientID,
		clientID: clientID,
		uuid: uuid.v1(),
		agentOriginID: agentOriginID,
		health: consts.targetHealth.CRITICAL,
		client_status: consts.clientStatus.INITIALIZING,
		managementAgentStatus: consts.managementAgentStatuses.UP,
		kafkaMessageSequence: utils.getMessageSequenceObjectFromKafkaMessageTypes(consts.clientKafkaMessageSeqTypes),
		agentKafkaMessageSequence: utils.getMessageSequenceObjectFromKafkaMessageTypes(consts.kafkaMessageTypes.AgentToManagement),
		managementAgentToken: managementAgentToken,
		clientToken: 1,
		maxReportID: 0,
		nvmfAttachmentsID: 0,
		keepAliveCounter: 0,
		attachmentsVersion: consts.INITIAL_ATTACHMENTS_VERSION,
		isUmClient: false,
		isNewClient: true,
		block_devices: [],
		attachments: {},
		dateCreated: new Date(),
		dateModified: new Date(),
		featureCompatibilityVersion,
		topics
	};
}

function handleClientCreation(clientID, agentOriginID, featureCompatibilityVersion, managementAgentToken, callback) {
	kafkaModule.createClientTopics(clientID, featureCompatibilityVersion, (err, topics) => {
		if (err)
			return callback(err);

		const db = app.get('db');
		const clientCollection = db.collection('client');
		const newClient = getNewClient(clientID, agentOriginID, featureCompatibilityVersion, managementAgentToken, topics);

		clientCollection.insertOne(newClient, err => {
			if (err)
				// DUPLICATE_KEY => another management created the new client so we can ignore it
				return callback(err.code == consts.mongoErrors.DUPLICATE_KEY ? undefined : err);

			eventsModule.emitEvent([eventsModule.getClientID(clientID)], objectNotifier.events.newClientEvent, newClient);
			sendUpdateAgentTokenMessageWithDebouncer(
				clientID,
				newClient.topics[consts.topicSuffix.AGENT_MAIN],
				agentOriginID,
				managementAgentToken,
				newClient.agentKafkaMessageSequence
			);
			callback();
		});
	});
}

scope.handleGetTargetNICs = (message, callback) => {
	let targetRequests = message.payload.targets;
	let targetIDs = targetRequests.map(req => req.node_id);
	let targetsIDsForWaitingOnNICs = [];
	let targetRequestsById = {};

	targetRequests.forEach(targetRequest => {
		targetRequestsById[targetRequest.node_id] = targetRequest;
	});

	function getDbTargetNicsVersion(targetID, callback) {
		let db = app.get('db');
		let serverCollection = db.collection('server');
		let query = { node_id: targetID };
		let projection = { nics: 1, nicsVersion: 1 };

		serverCollection.findOne(query, { projection: projection }, (err, target) => {
			if (err)
				return callback(new MongoError(err));

			callback(null, target);
		});
	}

	async.each(targetRequests, (targetNicRequest, eachCB) => {
		let targetID = targetNicRequest.node_id;
		// look for targets with the same nicsVersion as requested
		let nicsVersionFromClient = targetNicRequest.nicsVersion;

		getDbTargetNicsVersion(targetID, function(err, dbTarget) {
			if (err)
				return callback(err);

			if (!dbTarget)
				return eachCB();

			if (nicsVersionFromClient == dbTarget.nicsVersion) {
				targetsIDsForWaitingOnNICs.push(targetID);
				eachCB();
			} else if (nicsVersionFromClient > dbTarget.nicsVersion) {
				// This can happen if the target was deleted
				// we adopt the greater nicsVersion from client + 1 and will send the nics in the response
				adoptAndIncTargetNicsVersion(targetID, dbTarget.nicsVersion, nicsVersionFromClient, () => {
					eachCB();
				});
			} else {
				eachCB();
			}
		});
	}, () => {
		let db = app.get('db');
		let clientCollection = db.collection('client');

		// send UpdateTargetNICs message for targets with different nicsVersion
		let targetsIDsToSendUpdatTargetsNICs = targetIDs.filter(targetID => targetsIDsForWaitingOnNICs.indexOf(targetID) == -1);

		async.parallel([
			function(callback) {
				// save waitingForTargetNics on the client for targets with the same nicsVersion as in the DB
				if (!targetsIDsForWaitingOnNICs.length)
					return callback();

				let clientUpdate = { $set: {} };
				targetsIDsForWaitingOnNICs.forEach((targetID) => {
					clientUpdate.$set[`waitingForTargetNics.${scope.encodeTargetID(targetID)}`] = targetRequestsById[targetID].nicsVersion;
				});

				clientCollection.updateOne({ _id: message.clientID }, clientUpdate, (err) => {
					if (err)
						new MongoError(err).log();

					async.eachSeries(targetsIDsForWaitingOnNICs, function checkForRaceNicChanges(targetID, eachCB) {
						getDbTargetNicsVersion(targetID, function(err, dbTarget) {
							if (err)
								return callback(err);

							if (!dbTarget)
								return eachCB();

							let nicsVersionFromClient = targetRequestsById[targetID];
							if (nicsVersionFromClient < dbTarget.nicsVersion)
								// there was a nic change
								targetsIDsToSendUpdatTargetsNICs.push(targetID);

							eachCB();
						});
					}, callback);
				});
			}, function(callback) {
				if (!targetsIDsToSendUpdatTargetsNICs.length)
					return callback();

				scope.sendUpdateTargetNICsMessage(message.clientID, null, targetsIDsToSendUpdatTargetsNICs, message.originID, callback);
			}
		], function() {
			callback();
		});
	});
};

scope.encodeTargetID = function(targetID) {
	return targetID.replace(/\./g, '$');
};

scope.updateClientsOnNicsVersionChange = function(targetID, callback) {
	const db = app.get('db');
	const clientCollection = db.collection('client');

	let query = {};
	query[`waitingForTargetNics.${scope.encodeTargetID(targetID)}`] = { $exists: true };

	let projection = { clientID: 1, topics: 1 };
	clientCollection.find(query, projection).toArray((err, clients) => {
		if (err)
			return callback(new MongoError(err).log());

		async.eachSeries(
			clients,
			(client, cb) => {
				scope.sendUpdateTargetNICsMessage(client.clientID, client.topics[consts.topicSuffix.CLIENT_MAIN], [targetID], client.clientOriginID, err => {
					if (err)
						logger.sysDEBUG(`Error updating client ${client.clientID} with updated NICs for target ${targetID}`);
					cb();
				});
			},
			callback);
	});
};

function adoptAndIncTargetNicsVersion(targetID, lastDbNicsVersion, clientReportedNicsVersion, callback) {
	var db = app.get('db');
	var serverCollection = db.collection('server');

	var $update = { nicsVersion: clientReportedNicsVersion + 1 };
	serverCollection.findOneAndUpdate(
		{ node_id: targetID, nicsVerion: lastDbNicsVersion },
		[$update],
		function(err, res) {
			if (err)
				return callback(new MongoError(err).log());

			if (!res) {
				logger.sysDEBUG(`adoptAndIncTargetNicsVersion(${targetID}, ${clientReportedNicsVersion}): nicsVersion could not be adopted from client`);
				return callback();
			}

			callback(err, res);
		});
}

function getTargetNICs(targetIDs, cb) {
	var query = {
		filter: {
			node_id: { $in: targetIDs },
		},
		skip: 0,
		limit: 0,
		projection: {
			'node_id': 1,
			'uuid': 1,
			'targetUpdatesSequence': 1,
			'nicsVersion': 1,
			'nics.uuid': 1,
			'nics.pkey': 1,
			'nics.nicID': 1,
			'nics.guid': 1,
			'nics.protocol': 1,
			'nics.nodeID': 1,
			'nics.nodeUUID': 1,
			'nics.status': 1
		}
	};

	utils.loadCollection('server', query, function(err, results) {
		let nicsByTarget = [];
		if (results && results.length)
			results = results.forEach((target) => {
				nicsByTarget.push({
					node_id: target.node_id,
					uuid: target.uuid,
					targetUpdatesSequence: target.targetUpdatesSequence,
					nicsVersion: target.nicsVersion,
					nics: target.nics
				});
			});

		cb(err, nicsByTarget);
	});
}

scope.sendUpdateTargetNICsMessage = function(clientID, topic, targetIDs, originID, cb) {
	getTargetNICs(targetIDs, (err, nicsByTarget) => {
		if (err) {
			logger.sysDEBUG('error while trying to fetch target nics for client ' + clientID);
			return cb(err);
		}

		let message = new UpdateTargetNICs(nicsByTarget, originID);
		return kafkaModule.sendMessages(
			topic || (cb => kafkaModule.getClientMainTopic(clientID, cb)),
			[message],
			cb
		);
	});
};

scope.fetchClientByID = function(clientID, cb) {
	utils.fetchEntityByID('client', clientID, false, {}, systemMessages.CLIENT_NOT_FOUND, cb);
};

// ─── Thin Provisioning ───────────────────────────────────────────────────────

// Per-CDV LRU of recently-handled (requestId → response payload) pairs, used
// for idempotent retries of AttachSatelliteRequest.  Bounded to keep memory
// trivial; entries are evicted when the per-CDV map exceeds REQUEST_LRU_SIZE.
// This is best-effort — Mongo state (CDV.allocatorGenerationLastAttached) is
// the source of truth.  The cache only saves a duplicate attach from re-running.
const REQUEST_LRU_SIZE = 32;
const attachSatelliteRequestCache = new Map(); // cdvUUID → Map<requestId, response>

function rememberSatelliteResponse(cdvUUID, requestId, response) {
	let perCdv = attachSatelliteRequestCache.get(cdvUUID);
	if (!perCdv) {
		perCdv = new Map();
		attachSatelliteRequestCache.set(cdvUUID, perCdv);
	}
	if (perCdv.size >= REQUEST_LRU_SIZE) {
		const firstKey = perCdv.keys().next().value;
		perCdv.delete(firstKey);
	}
	perCdv.set(requestId, response);
}

function recallSatelliteResponse(cdvUUID, requestId) {
	const perCdv = attachSatelliteRequestCache.get(cdvUUID);
	return perCdv ? perCdv.get(requestId) : undefined;
}

// Send an AttachSatelliteResponse to the requesting TOMA's TOMA_COMMANDS topic.
// Best-effort: if the target server can't be located, log and drop — the TOMA
// will retry with the same requestId (idempotent on our side).
function sendSatelliteResponseToTOMA(tomaHostname, payload, cb) {
	const db = app.get('db');
	const serverCollection = db.collection('server');
	serverCollection.findOne(
		{ $or: [{ node_id: tomaHostname }, { hostname: tomaHostname }] },
		{ projection: { topics: 1, node_id: 1, hostname: 1 } },
		(err, server) => {
			if (err || !server || !server.topics) {
				logger.sysDEBUG(`sendSatelliteResponseToTOMA: cannot locate TOMA ${tomaHostname} (err=${err})`);
				return cb && cb();
			}
			const topic = server.topics[consts.topicSuffix.TOMA_COMMANDS];
			if (!topic) {
				logger.sysDEBUG(`sendSatelliteResponseToTOMA: TOMA ${tomaHostname} has no TOMA_COMMANDS topic`);
				return cb && cb();
			}
			kafkaModule.sendMessages(topic, [new AttachSatelliteResponse(payload)], cb || (() => {}));
		}
	);
}

// Kafka entry point for AttachSatelliteRequest (TOMA → management).  See Phase 2
// in nvmesh-kernel/design/SatelliteVolumeForCDVAlloc.md.
//
// Validates the request, runs the standard exclusive-preempt attach against the
// CDV's satellite, persists (allocatorGenerationLastAttached, currentAllocatorTomaHostname)
// on the CDV document, and replies with AttachSatelliteResponse on the requesting
// TOMA's TOMA_COMMANDS topic.  Idempotent on (cdvUUID, requestId).
scope.handleAttachSatelliteRequest = (message, callback) => {
	const payload = message.payload || {};
	const { cdvUUID, allocatorTomaHostname, allocatorGeneration, requestId } = payload;
	const sender = message.hostname;

	// Only OK responses get cached for idempotent retry — a transient failure
	// (INTERNAL_ERR, etc.) should let the next retry with the same requestId
	// re-run the operation.  Terminal failures (CDV_NOT_FOUND, CDV_BEING_DELETED,
	// STALE_GENERATION) are also cached so the TOMA stops retrying immediately.
	const TERMINAL_FAILURES = new Set([
		AttachSatelliteResponseStatus.CDV_NOT_FOUND,
		AttachSatelliteResponseStatus.CDV_BEING_DELETED,
		AttachSatelliteResponseStatus.STALE_GENERATION,
	]);

	const finish = responsePayload => {
		const cacheable = responsePayload.status === AttachSatelliteResponseStatus.OK
			|| TERMINAL_FAILURES.has(responsePayload.status);
		if (cacheable)
			rememberSatelliteResponse(cdvUUID, requestId, responsePayload);
		sendSatelliteResponseToTOMA(allocatorTomaHostname || sender, responsePayload, () => callback());
	};

	const respondError = (status, errMsg) => {
		logger.sysDEBUG(`handleAttachSatelliteRequest: cdv=${cdvUUID} reqId=${requestId} status=${status}: ${errMsg}`);
		finish({
			cdvUUID,
			requestId,
			status,
			satelliteUUID: null,
			satelliteTargets: [],
			reservationVersion: 0,
			allocatorGeneration: allocatorGeneration || 0,
		});
	};

	// Basic shape check.
	if (!cdvUUID || !allocatorTomaHostname || allocatorGeneration == null || !requestId)
		return respondError(AttachSatelliteResponseStatus.INTERNAL_ERR,
			`malformed payload (cdv=${cdvUUID} toma=${allocatorTomaHostname} gen=${allocatorGeneration} reqId=${requestId})`);

	// Sender hostname must match the claimed allocator hostname.  Prevents a
	// rogue TOMA from requesting the satellite on behalf of another node.
	if (sender && sender !== allocatorTomaHostname)
		return respondError(AttachSatelliteResponseStatus.INTERNAL_ERR,
			`sender hostname '${sender}' does not match allocatorTomaHostname '${allocatorTomaHostname}'`);

	// Idempotent retry: if we already processed this (cdvUUID, requestId), reply with the cached response.
	const cached = recallSatelliteResponse(cdvUUID, requestId);
	if (cached) {
		logger.sysDEBUG(`handleAttachSatelliteRequest: idempotent replay cdv=${cdvUUID} reqId=${requestId}`);
		return sendSatelliteResponseToTOMA(allocatorTomaHostname, cached, () => callback());
	}

	const db = app.get('db');
	const volumeCollection = db.collection('volume');

	volumeCollection.findOne({ uuid: cdvUUID }, (err, cdv) => {
		if (err) return respondError(AttachSatelliteResponseStatus.INTERNAL_ERR, new MongoError(err).log());
		if (!cdv || cdv.volumeClass !== consts.volumeClass.CDV)
			return respondError(AttachSatelliteResponseStatus.CDV_NOT_FOUND, `CDV ${cdvUUID} not found or not a CDV`);
		if (cdv.action === consts.volumeActions.MARKED_FOR_DELETION)
			return respondError(AttachSatelliteResponseStatus.CDV_BEING_DELETED, `CDV ${cdvUUID} is marked for deletion`);
		if (!cdv.allocatorVolumeUUID)
			return respondError(AttachSatelliteResponseStatus.INTERNAL_ERR, `CDV ${cdv._id} has no allocator-satellite link`);

		// Monotonicity: a request from an older RAFT generation than the last
		// successfully-attached one is stale (e.g., the requesting TOMA was
		// elected, then RAFT re-elected someone newer before this Kafka request
		// arrived).  Reject so the requester re-syncs from RAFT.
		const lastGen = cdv.allocatorGenerationLastAttached || 0;
		if (allocatorGeneration < lastGen)
			return respondError(AttachSatelliteResponseStatus.STALE_GENERATION,
				`request gen ${allocatorGeneration} < last attached gen ${lastGen}`);

		scope.attachSatelliteForAllocator(cdvUUID, allocatorTomaHostname, allocatorGeneration, requestId,
			(attachErr, result) => {
				if (attachErr || !result) {
					return respondError(AttachSatelliteResponseStatus.INTERNAL_ERR,
						`attachSatelliteForAllocator failed: ${attachErr && attachErr.toString()}`);
				}

				// Persist the new allocator identity on the CDV document.
				// Conditional on (existing gen < this gen) so that if two attach
				// requests race (e.g., RAFT re-elects rapidly and TOMA-A gen 5
				// and TOMA-B gen 6 both arrive), the persists land in
				// generation order regardless of Mongo round-trip timing —
				// otherwise gen 5 could overwrite gen 6 and let a future stale
				// gen 5 request incorrectly preempt B.  Best-effort beyond
				// that — failure is logged but does not invalidate the attach
				// (the satellite is already exclusively held).
				volumeCollection.updateOne(
					{
						uuid: cdvUUID,
						volumeClass: consts.volumeClass.CDV,
						$or: [
							{ allocatorGenerationLastAttached: { $exists: false } },
							{ allocatorGenerationLastAttached: { $lt: allocatorGeneration } },
						],
					},
					{ $set: {
						allocatorGenerationLastAttached: allocatorGeneration,
						currentAllocatorTomaHostname: allocatorTomaHostname,
					} },
					updErr => {
						if (updErr) {
							new MongoError(updErr).log();
							logger.sysERROR(`handleAttachSatelliteRequest: failed to persist allocator identity for CDV ${cdvUUID}: ${updErr}`);
						}
						finish({
							cdvUUID,
							requestId,
							status: AttachSatelliteResponseStatus.OK,
							satelliteUUID: result.satelliteUUID,
							satelliteTargets: result.satelliteTargets,
							reservationVersion: result.reservationVersion,
							allocatorGeneration: allocatorGeneration,
						});
					}
				);
			}
		);
	});
};

// Internal entry point for the TOMA-driven satellite-volume attach.  Called
// from the Kafka handler for `AttachSatelliteRequest` (Phase 2).  REST callers
// cannot reach this — the user-facing /attach endpoint refuses CDV_MGMT.
//
// Returns via cb(err, result) where result is { satelliteUUID, satelliteTargets,
// reservationVersion } on success.
//
// Reuses the existing exclusive-preempt attach path: the preempt mechanism
// kicks any prior allocator TOMA holding the satellite, satisfying the
// "fence the previous allocator" requirement at the storage target.
scope.attachSatelliteForAllocator = (cdvUUID, tomaHostname, allocatorGeneration, requestId, cb) => {
	const db = app.get('db');
	const volumeCollection = db.collection('volume');
	const clientCollection = db.collection('client');

	logger.sysDEBUG(`attachSatelliteForAllocator: cdvUUID=${cdvUUID} toma=${tomaHostname} gen=${allocatorGeneration} reqId=${requestId}`);

	// TOMAs register with management as 'clients' (same collection as TPV
	// clients).  Look up the TOMA's client UUID first — attachVolumes needs it
	// to anchor the attachment record.
	clientCollection.findOne({ _id: tomaHostname }, { projection: { uuid: 1 } }, (errClient, tomaClient) => {
		if (errClient) return cb(new MongoError(errClient).log());
		if (!tomaClient)
			return cb(new SystemMessage(systemMessages.CLIENT_NOT_FOUND).addInfo(Entities.Client.ID, tomaHostname));

		const tomaClientUUID = tomaClient.uuid;

		volumeCollection.findOne({ uuid: cdvUUID, volumeClass: consts.volumeClass.CDV }, (err, cdv) => {
			if (err) return cb(new MongoError(err).log());
			if (!cdv) return cb(new SystemMessage(systemMessages.VOLUME_NOT_FOUND).addInfo(Entities.Volume.UUID, cdvUUID));
			if (!cdv.allocatorVolumeUUID)
				return cb(new SystemMessage(systemMessages.VOLUME_NOT_FOUND).addInfo(Entities.Error, `CDV ${cdv._id} has no satellite link`));

			volumeCollection.findOne({ uuid: cdv.allocatorVolumeUUID, volumeClass: consts.volumeClass.CDV_MGMT }, (err2, sat) => {
				if (err2) return cb(new MongoError(err2).log());
				if (!sat) return cb(new SystemMessage(systemMessages.VOLUME_NOT_FOUND).addInfo(Entities.Volume.UUID, cdv.allocatorVolumeUUID));

				// The reservation-transition validator (volume.js getTransitionValidity) rejects
				// a preempt request whose reservation.version does not match the current value on
				// the satellite document — defaulting to 0 will fail once the previous allocator
				// has attached (which bumps the version).  Read the current version and pass it
				// through so the preempt validates cleanly.
				const currentReservationVersion = (sat.reservation && sat.reservation.version) || 0;

				const requestedVolumes = [{
					name: sat._id,
					uuid: sat.uuid,
					reservation: {
						mode: consts.reservationModeNames.EXCLUSIVE_READ_WRITE,
						version: currentReservationVersion,
						preempt: true,
						isDetachOthers: true,
					},
					referenceID: `allocator:${cdvUUID}`,
				}];

				scope.attachVolumes(tomaHostname, tomaClientUUID, requestedVolumes, msgs => {
				// scope.attachVolumes does not directly return success/failure data;
				// poll the satellite document to obtain the new reservation.version.
					volumeCollection.findOne({ uuid: sat.uuid }, (err3, satAfter) => {
						if (err3) return cb(new MongoError(err3).log());
						if (!satAfter) return cb(new SystemMessage(systemMessages.VOLUME_NOT_FOUND).addInfo(Entities.Volume.UUID, sat.uuid));

						const isHeld = satAfter.reservation
						&& satAfter.reservation.mode === consts.reservationModes.EXCLUSIVE_READ_WRITE
						&& satAfter.reservation.reservedBy === tomaHostname;

						if (!isHeld) {
							const heldBy = satAfter.reservation && satAfter.reservation.reservedBy;
							const errMsg = `Satellite attach for ${tomaHostname} did not result in exclusive hold (current reservedBy=${heldBy})`;
							logger.sysDEBUG(`attachSatelliteForAllocator: ${errMsg}`);
							return cb(new SystemMessage(systemMessages.BUILD_RESPONSES_ERROR).addInfo(Entities.Error, errMsg));
						}

						const satelliteTargets = [];
						(satAfter.chunks || []).forEach(chunk => {
							(chunk.pRaids || []).forEach(praid => {
								(praid.diskSegments || []).forEach(seg => {
									if (seg.nodeUUID && !satelliteTargets.includes(seg.nodeUUID))
										satelliteTargets.push(seg.nodeUUID);
								});
							});
						});

						cb(null, {
							satelliteUUID: satAfter.uuid,
							satelliteTargets: satelliteTargets,
							reservationVersion: satAfter.reservation.version,
							allocatorGeneration: allocatorGeneration,
							messages: msgs,
						});
					});
				});
			});
		});
	});
};

scope.attachTPV = (clientID, clientUUID, tpvName, options, callback) => {
	if (typeof options === 'function') { callback = options; options = {}; }
	const syncFlush = options.syncFlush !== false;
	const db = app.get('db');
	const volumeCollection = db.collection('volume');
	const clientCollection = db.collection('client');
	let tpv, cdv;

	async.series([
		function applySyncFlush(cb) {
			const sourceUUID = syncFlush ? 'sync_flush' : '';
			volumeCollection.updateOne(
				{ _id: tpvName, volumeClass: consts.volumeClass.TPV },
				{ $set: { sourceUUID: sourceUUID } },
				err => {
					if (err) new MongoError(err).log();
					cb();
				}
			);
		},
		function loadTPVAndCDV(cb) {
			volumeCollection.findOne({ _id: tpvName, volumeClass: consts.volumeClass.TPV }, (err, tpvDoc) => {
				if (err) return cb(new MongoError(err).log());
				if (!tpvDoc) return cb(new SystemMessage(systemMessages.VOLUME_NOT_FOUND).addInfo(Entities.Volume.ID, tpvName));
				tpv = tpvDoc;

				volumeCollection.findOne({ uuid: tpv.tpvConfig.cdvUUID, volumeClass: consts.volumeClass.CDV }, (err2, cdvDoc) => {
					if (err2) return cb(new MongoError(err2).log());
					if (!cdvDoc) return cb(new SystemMessage(systemMessages.VOLUME_NOT_FOUND).addInfo(Entities.Volume.UUID, tpv.tpvConfig.cdvUUID));
					cdv = cdvDoc;
					cb();
				});
			});
		},
		function checkNotEvictingFromCDV(cb) {
			// Per-client CDV preempt (Step 2a of TPV_PerClientCDVPreemption.md):
			// refuse the attach if this client has an in-flight eviction on this
			// CDV. The gate is per-(client, CDV); an EVICTING state on another
			// CDV does not block. The error is retriable — the client retries
			// once the eviction clears (Step 14 cleanupDB) or the reaper (Step
			// 14b) completes it.
			//
			// `attachments` is a UUID-keyed object (not an array) — see §3 of
			// this file and the patterns at lines 1139, 3234. Access the CDV's
			// attachment entry via attachments[cdv.uuid].
			clientCollection.findOne(
				{ _id: clientID },
				{ projection: { [`attachments.${cdv.uuid}.action`]: 1 } },
				(err, clientDoc) => {
					if (err) return cb(new MongoError(err).log());
					const attachment = clientDoc && clientDoc.attachments && clientDoc.attachments[cdv.uuid];
					if (attachment && attachment.action === consts.volumeAttachmentActions.EVICTING) {
						return cb(new SystemMessage(systemMessages.CLIENT_EVICTING_FROM_CDV)
							.addInfo(Entities.Client.ID, clientID)
							.addInfo(Entities.Volume.ID, cdv._id));
					}
					cb();
				}
			);
		},
		function preemptPreviousHolderIfAny(cb) {
			// Attach-with-preempt (Step 15.3 of TPV_PerClientCDVPreemption.md):
			// if the TPV is currently held by a different client, fence that
			// client from the CDV via the narrow per-client primitive instead
			// of the today's volume-wide reservation.version bump that disturbs
			// every survivor on the CDV. options.preempt is the attacher's
			// intent signal (set by callers that wish to displace a stale
			// holder); without it we just proceed and let management's normal
			// exclusiveClient conflict path reject.
			const prevHolder = tpv.tpvConfig && tpv.tpvConfig.exclusiveClient;
			if (!prevHolder || prevHolder === clientID || !options.preempt) return cb();

			scope.preemptClientFromCDV(cdv.uuid, prevHolder, err => {
				if (err) {
					// Propagate preempt failure — MUST NOT proceed with the
					// attach, otherwise the new client gets a floor-stamped
					// CDV attach while the old client's reg_ctx may still
					// exist on some TOMAs (both writing → corruption).
					return cb(err);
				}
				// Reload cdv to pick up the new admission floor stamped by
				// the preempt, and reload tpv to observe the cleared
				// exclusiveClient.
				volumeCollection.findOne({ _id: tpv._id, volumeClass: consts.volumeClass.TPV }, (err2, tpvDoc) => {
					if (err2) return cb(new MongoError(err2).log());
					if (tpvDoc) tpv = tpvDoc;
					volumeCollection.findOne({ uuid: tpv.tpvConfig.cdvUUID, volumeClass: consts.volumeClass.CDV }, (err3, cdvDoc) => {
						if (err3) return cb(new MongoError(err3).log());
						if (cdvDoc) cdv = cdvDoc;
						cb();
					});
				});
			});
		},
		function attachCDV(cb) {
			// attachVolumes handles both cases: new CDV attach and ref-only update
			// (CDV already SHARED_RW attached due to another TPV or TOMA ref).
			// isHidden must be false (not set) so the client kernel gets a real R/W
			// block device for TPV L1-tree I/O (load_state / flush_state).  With
			// isHidden=true the kernel skips gendisk/queue creation and tpv_cdv_sync_io
			// cannot submit bios.  Same rationale as cdvTomaAutoAttach.js isHidden=false.
			//
			// Step 2b: stamp the current admission floor on reservation.version so
			// the client's REGISTER to TOMA carries the floor and TOMA can reject
			// stale-version retries from an evicted client.
			const admissionFloor = (cdv.cdvConfig && cdv.cdvConfig.admissionFloor) || 0;
			scope.attachVolumes(clientID, clientUUID, [{
				uuid: cdv.uuid,
				name: cdv._id,
				referenceID: `tpv:${tpv.uuid}`,
				reservation: {
					mode: consts.reservationModeNames.SHARED_READ_WRITE,
					version: admissionFloor,
				}
			}], () => cb());
		},
		function attachTPVVolume(cb) {
			scope.attachVolumes(clientID, clientUUID, [{
				uuid: tpv.uuid,
				name: tpv._id,
				reservation: { mode: consts.reservationModeNames.EXCLUSIVE_READ_WRITE },
				cdvConf: {
					uuid: cdv.uuid,
					name: cdv._id,
					chunks: cdv.chunks,
				}
			}], () => cb());
		},
		function setExclusiveClient(cb) {
			volumeCollection.findOneAndUpdate(
				{ _id: tpvName, volumeClass: consts.volumeClass.TPV },
				{ $set: { 'tpvConfig.exclusiveClient': clientID } },
				(err) => {
					if (err) new MongoError(err).log();
					cb();
				}
			);
		},
		function recalcTPVStatus(cb) {
			volumeModule.calculateAndUpdateVolumeStatus(tpvName, null, () => cb());
		}
	], callback);
};

scope.detachTPV = (clientID, clientUUID, tpvName, callback) => {
	const db = app.get('db');
	const volumeCollection = db.collection('volume');
	let tpv, cdv;

	async.series([
		function loadTPVAndCDV(cb) {
			volumeCollection.findOne({ _id: tpvName, volumeClass: consts.volumeClass.TPV }, (err, tpvDoc) => {
				if (err) return cb(new MongoError(err).log());
				if (!tpvDoc) return cb(new SystemMessage(systemMessages.VOLUME_NOT_FOUND).addInfo(Entities.Volume.ID, tpvName));
				tpv = tpvDoc;

				volumeCollection.findOne({ uuid: tpv.tpvConfig.cdvUUID, volumeClass: consts.volumeClass.CDV }, (err2, cdvDoc) => {
					if (err2) return cb(new MongoError(err2).log());
					if (!cdvDoc) return cb(new SystemMessage(systemMessages.VOLUME_NOT_FOUND).addInfo(Entities.Volume.UUID, tpv.tpvConfig.cdvUUID));
					cdv = cdvDoc;
					cb();
				});
			});
		},
		function detachTPVVolume(cb) {
			scope.detachVolumes(clientID, clientUUID, [{ uuid: tpv.uuid, name: tpv._id }], () => cb());
		},
		function maybeDetachCDV(cb) {
			// Remove tpv:<uuid> referenceID from CDV attachment. detachVolumes will send a full
			// DetachVolumes message only if this was the last referenceID (no other tpv:* or toma:* refs).
			scope.detachVolumes(clientID, clientUUID, [{
				uuid: cdv.uuid,
				name: cdv._id,
				referenceID: `tpv:${tpv.uuid}`
			}], () => cb());
		},
		function clearExclusiveClient(cb) {
			volumeCollection.findOneAndUpdate(
				{ _id: tpvName },
				{ $unset: { 'tpvConfig.exclusiveClient': 1 } },
				(err) => {
					if (err) new MongoError(err).log();
					cb();
				}
			);
		},
		function recalcTPVStatus(cb) {
			volumeModule.calculateAndUpdateVolumeStatus(tpvName, null, () => cb());
		}
	], callback);
};

/**
 * Cleans up TPV-specific state after an involuntary detach (preemption, stale cleanup, client deletion).
 * For each attachment: if the volume is a TPV, clears tpvConfig.exclusiveClient and removes
 * the tpv:<uuid> referenceID from the parent CDV, conditionally detaching the CDV.
 * Non-TPV attachments are skipped silently.
 *
 * Per-client CDV preempt integration (TPV_PerClientCDVPreemption.md §2.10 Step 15.2):
 * For each distinct CDV whose TPVs are being cleaned up here, first call
 * preemptClientFromCDV to fence the stale client at the TOMA layer (raise
 * CDV admission_floor + terminate reg_ctx on every CDV segment). Without this,
 * a partitioned stale client whose reg_ctx still lives on TOMA could continue
 * RDMA-writing to already-mapped CDV extents — the Path 1 data-path hole
 * described in §2.10.4. preemptClientFromCDV is idempotent on retry ($max
 * floor, linear reg_ctx walk), so running it here before the per-TPV cleanup
 * is safe and closes the stale-writer gap for the stale-client cleanup path
 * (not just operator-initiated force-detach).
 */
function cleanupTPVReferencesForDetachedClient(clientID, attachments, done) {
	const db = app.get('db');
	const volumeCollection = db.collection('volume');
	const clientCollection = db.collection('client');

	const uuids = attachments.map(a => a.uuid).filter(Boolean);
	if (!uuids.length) return done();

	volumeCollection.find({ uuid: { $in: uuids }, volumeClass: consts.volumeClass.TPV })
		.project({ _id: 1, uuid: 1, tpvConfig: 1 })
		.toArray((err, tpvDocs) => {
			if (err) { new MongoError(err).log(); return done(); }
			if (!tpvDocs || !tpvDocs.length) return done();

			// Collect distinct CDV UUIDs this client held TPVs on. Preempt the
			// client on each CDV at the TOMA layer BEFORE running per-TPV
			// cleanup — otherwise a partitioned stale client's reg_ctx keeps
			// living on TOMA and can continue issuing RDMA writes to already-
			// mapped CDV extents (§2.10.4 Path 1 data-path hole).
			const cdvUUIDs = [...new Set(
				tpvDocs.map(t => t.tpvConfig && t.tpvConfig.cdvUUID).filter(Boolean)
			)];

			async.series([
				preemptCb => async.eachSeries(cdvUUIDs, (cdvUUID, nextCDV) => {
					scope.preemptClientFromCDV(cdvUUID, clientID, () => nextCDV());
				}, preemptCb),
				perTpvCb => async.each(tpvDocs, (tpv, next) => {
					async.series([
						function clearExclusiveClient(cb) {
							volumeCollection.updateOne(
								{ _id: tpv._id, volumeClass: consts.volumeClass.TPV },
								{ $unset: { 'tpvConfig.exclusiveClient': 1 } },
								err2 => { if (err2) new MongoError(err2).log(); cb(); }
							);
						},
						function recalcTPVStatus(cb) {
							volumeModule.calculateAndUpdateVolumeStatus(tpv._id, null, () => cb());
						},
						function removeCDVReference(cb) {
							if (!tpv.tpvConfig?.cdvUUID) return cb();

							// Look up the CDV to get its _id
							volumeCollection.findOne({ uuid: tpv.tpvConfig.cdvUUID, volumeClass: consts.volumeClass.CDV },
								{ projection: { _id: 1, uuid: 1 } }, (err2, cdv) => {
									if (err2 || !cdv) {
										if (err2) new MongoError(err2).log();
										return cb();
									}

									// Look up this client's UUID for the detachVolumes call
									clientCollection.findOne({ _id: clientID }, { projection: { uuid: 1 } }, (err3, clientDoc) => {
										if (err3 || !clientDoc) {
											if (err3) new MongoError(err3).log();
											return cb();
										}

										// Remove the tpv:<uuid> referenceID; detachVolumes handles conditional CDV detach
										// when no tpv:* or toma:* refs remain on this client for this CDV.
										scope.detachVolumes(clientID, clientDoc.uuid, [{
											uuid: cdv.uuid,
											name: cdv._id,
											referenceID: `tpv:${tpv.uuid}`
										}], () => cb());
									});
								});
						}
					], next);
				}, perTpvCb),
			], done);
		});
}

module.exports = scope;

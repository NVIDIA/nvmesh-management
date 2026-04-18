/*
 * SPDX-FileCopyrightText: Copyright (c) 2026 NVIDIA CORPORATION & AFFILIATES. All rights reserved.
 * SPDX-License-Identifier: Apache-2.0
 */

/* global app */

const scope = {};
module.exports = scope;

const async = require('async');

const logger = require('../logger.js');
const consts = require('../consts.js');
var { Entities, SystemMessage, MongoError, SystemAdminMessage } = require('./error.js');
const systemMessages = require('../systemMessages.js');
const kafkaModule = require('./kafka.js');
const volumeModule = require('./volume');
const clientModule = require('./client.js');
const { InitEncryption } = require('../models/kafkaMessages/InitEncryption');
const { RequestEncryptionResponse } = require('../models/kafkaMessages/RequestEncryptionResponse');
const { AddPassphrase } = require('../models/kafkaMessages/AddPassphrase.js');
const { DeletePassphrase } = require('../models/kafkaMessages/DeletePassphrase.js');


scope.afterModuleLoaded = () => {
	({ Entities, SystemMessage, MongoError, SystemAdminMessage } = require('./error.js'));
};

scope.chooseTOMAForTPVEncryption = (tpvVolume, callback) => {
	const db = app.get('db');
	const volumeCollection = db.collection('volume');
	const serverCollection = db.collection('server');

	const cdvId = tpvVolume.tpvConfig && tpvVolume.tpvConfig.cdvId;
	if (!cdvId) {
		return callback(new SystemMessage(systemMessages.GET_EXECUTING_TOMA_FOR_ENCRYPTION_FAILURE)
			.addInfo(Entities.Volume.ID, tpvVolume.name)
			.addInfo(Entities.Error, 'TPV has no parent CDV'));
	}

	volumeCollection.findOne({ _id: cdvId, volumeClass: consts.volumeClass.CDV }, (err, cdv) => {
		if (err) {
			return callback(new MongoError(err).log());
		}
		if (!cdv) {
			return callback(new SystemMessage(systemMessages.GET_EXECUTING_TOMA_FOR_ENCRYPTION_FAILURE)
				.addInfo(Entities.Volume.ID, tpvVolume.name)
				.addInfo(Entities.Error, `Parent CDV ${cdvId} not found`));
		}

		// Candidates: the same node set used by cdvTomaAutoAttach — every node
		// that owns any disk segment in the CDV's first pRAID chunk. The CDV
		// schema is chunks[0].pRaids[].diskSegments[].node_id (see
		// modules/cdvTomaAutoAttach.js::_firstPRaidNodeIds). TOMA liveness
		// (tomaStatus === UP) is checked separately against the server doc.
		if (!cdv.chunks || !cdv.chunks[0] || !cdv.chunks[0].pRaids) {
			return callback(new SystemMessage(systemMessages.GET_EXECUTING_TOMA_FOR_ENCRYPTION_FAILURE_UNAVAILABLE_TARGET)
				.addInfo(Entities.Volume.ID, tpvVolume.name)
				.addInfo(Entities.Error, `CDV ${cdvId} has no first-pRAID chunk`));
		}
		const candidateIds = [...new Set(
			cdv.chunks[0].pRaids
				.flatMap(pRaid => pRaid.diskSegments || [])
				.map(seg => seg && seg.node_id)
				.filter(Boolean)
		)];

		if (!candidateIds.length) {
			return callback(new SystemMessage(systemMessages.GET_EXECUTING_TOMA_FOR_ENCRYPTION_FAILURE_UNAVAILABLE_TARGET)
				.addInfo(Entities.Volume.ID, tpvVolume.name));
		}

		serverCollection.find({
			_id: { $in: candidateIds },
			tomaStatus: consts.tomaStatuses.UP
		}, { projection: { bootTime: 1, topics: 1 } }).toArray((err, targets) => {
			if (err)
				return callback(new MongoError(err).log());

			if (!targets || !targets.length) {
				return callback(new SystemMessage(systemMessages.GET_EXECUTING_TOMA_FOR_ENCRYPTION_FAILURE_UNAVAILABLE_TARGET)
					.addInfo(Entities.Volume.ID, tpvVolume.name));
			}

			// Prefer the CDV's current allocator TOMA (same locality heuristic
			// cdvTomaAutoAttach uses). The CDV document field populated by
			// handleAttachSatelliteRequest (client.js:5401) is
			// currentAllocatorTomaHostname.
			const allocatorHost = cdv.currentAllocatorTomaHostname;
			let chosen = allocatorHost ? targets.find(t => t._id === allocatorHost) : null;
			if (!chosen) {
				chosen = targets[Math.floor(Math.random() * targets.length)];
			}
			callback(null, chosen);
		});
	});
};

scope.chooseTOMAForEncryption = (volume, callback) => {
	if (volume.volumeClass === consts.volumeClass.TPV) {
		return scope.chooseTOMAForTPVEncryption(volume, callback);
	}

	const db = app.get('db');
	const serverCollection = db.collection('server');
	const lockCollection = db.collection('lock');

	let availableTargets;
	let zone;
	let lock;

	async.series([
		// Step 1: Get available targets for this volume
		cb => {
			const pipeline = [
				{ $match: { zone: volume.chunks[0].zone, tomaStatus: consts.tomaStatuses.UP } },
				{ $project: { bootTime: 1, topics: 1, zone: 1 } }
			];

			serverCollection.aggregate(pipeline).toArray((err, targets) => {
				if (err) {
					let mongoError = new MongoError(err);
					mongoError.log();
					let error = new SystemMessage(systemMessages.GET_EXECUTING_TOMA_FOR_ENCRYPTION_FAILURE)
						.addInfo(Entities.Error, mongoError)
						.addInfo(Entities.Volume.ID, volume.name);
					return cb(error);
				}

				if (!targets || !targets.length) {
					let error = new SystemMessage(systemMessages.GET_EXECUTING_TOMA_FOR_ENCRYPTION_FAILURE_UNAVAILABLE_TARGET)
						.addInfo(Entities.Volume.ID, volume.name);
					return cb(error);
				}

				zone = targets[0].zone;
				availableTargets = targets.reduce((acc, target) => {
					acc[target._id] = target;
					return acc;
				}, {});
				cb();
			});
		},

		// Step 2: Get lock and increment encryption command index
		cb => {
			lockCollection.findOneAndUpdate(
				{ _id: zone },
				{ $inc: { encryptionCommandIndex: 1 } },
				{ returnDocument: consts.mongoReturnDocument.AFTER },
				(err, result) => {
					if (err)
						return cb(new MongoError(err).log());

					if (!result)
						return cb(new SystemMessage(systemMessages.ZONE_NOT_FOUND).addInfo(Entities.Target.zone, zone));

					if (!result.targetsInZone || !result.targetsInZone.length)
						return cb(new SystemMessage(systemMessages.NO_TARGETS_IN_ZONE).addInfo(Entities.Target.zone, zone));

					lock = result;
					cb();
				}
			);
		}
	], err => {
		if (err)
			return callback(err);

		// Select TOMA for encryption using round-robin approach
		const targetIndex = lock.encryptionCommandIndex % lock.targetsInZone.length;
		const tomaForEncryptionID = lock.targetsInZone[targetIndex];
		let tomaForEncryption = availableTargets[tomaForEncryptionID];

		// If selected target is not available, pick a random one from available targets
		if (!tomaForEncryption) {
			const availableTargetsArray = Object.values(availableTargets);
			const randomIndex = Math.floor(Math.random() * availableTargetsArray.length);
			tomaForEncryption = availableTargetsArray[randomIndex];
		}

		callback(null, tomaForEncryption);
	});
};

scope.resendStaleEncryptionCommands = (cb) => {
	const db = app.get('db');
	const volumeCollection = db.collection('volume');
	const pipeline = [{
		$match: {
			'encryption.commandStatus': consts.encryptionCommandStatuses.PENDING_SEND
		}
	}, {
		$project: {
			uuid: 1,
			encryption: 1
		}
	}, {
		$lookup: {
			from: 'server',
			let: { serverID: '$encryption.executingTOMA' },
			pipeline: [{
				$match: { $expr: { $eq: ['$_id', '$$serverID'] } }
			}, {
				$project: { _id: 0, topics: 1 }
			}],
			as: 'executingTOMATopics'
		}
	}, {
		$addFields: {
			executingTOMATopics: { $arrayElemAt: ['$executingTOMATopics.topics', 0] }
		}
	}];

	volumeCollection.aggregate(pipeline).toArray((err, results) => {
		if (err)
			return cb(new MongoError(err).log());

		async.eachSeries(results, (volume, callback) => {
			async.series([
				(callback) => {
					scope.sendRequestEncryptionResponse(volume, (err) => {
						callback(err);
					});
				},
				(callback) => {
					scope.updateLastCommandSent(
						volume.uuid,
						volume.encryption.commandIndex,
						consts.volumeEncryptionCommands.REQUEST_RESPONSE,
						() => {
							callback();
						}
					);
				}
			], () => {
				callback();
			});
		}, (err) => {
			cb(err);
		});
	});
};

// Startup cleanup: if management died between an encryption command's
// response and the TPV-detach it was supposed to trigger, the TPV is left
// attached to the TOMA and blocks the real client from reattaching. Walk
// any TPVs that still carry encryption.command.tpvAutoAttachedTOMA and whose
// command is EXECUTED (response already recorded) and drive the detach.
// TPVs whose command is still PENDING_SEND / SENT are handled by the
// existing resendStaleEncryptionCommands + handleCommandResponse paths.
scope.cleanupTPVAutoAttachesAfterStartup = (cb) => {
	const db = app.get('db');
	const volumeCollection = db.collection('volume');

	volumeCollection.find({
		volumeClass: consts.volumeClass.TPV,
		'encryption.command.tpvAutoAttachedTOMA': { $exists: true, $ne: null },
		'encryption.command.status': consts.encryptionCommandStatuses.EXECUTED,
	}, { projection: { _id: 1, 'encryption.command.tpvAutoAttachedTOMA': 1 } }).toArray((err, tpvs) => {
		if (err) { new MongoError(err).log(); return cb && cb(); }
		async.eachSeries(tpvs || [], (tpv, next) => {
			const tomaId = tpv.encryption.command.tpvAutoAttachedTOMA;
			scope.detachTPVFromTOMAForEncryption(tpv._id, tomaId, () => {
				volumeCollection.updateOne(
					{ _id: tpv._id },
					{ $unset: { 'encryption.command.tpvAutoAttachedTOMA': 1 } },
					() => next()
				);
			});
		}, () => cb && cb());
	});
};

scope.sendRequestEncryptionResponse = (volume, cb) => {
	const requestResponseMessage = new RequestEncryptionResponse(
		volume.encryption.executingTOMA,
		volume._id,
		volume.uuid,
		volume.encryption.commandIndex);

	kafkaModule.sendMessages(volume.executingTOMATopics[consts.topicSuffix.TOMA_COMMANDS], [requestResponseMessage], cb);
};

scope.sendEncryptionCommandToTOMA = (encryptionObj, command, executingTOMA, cb) => {
	let encryptionMessage;

	switch (command) {
		case consts.volumeEncryptionCommands.INIT_ENCRYPTION:
			encryptionMessage = scope.getInitEncryptionMessage(encryptionObj, executingTOMA);

			break;
		case consts.volumeEncryptionCommands.ADD_PASSPHRASE:
			encryptionMessage = scope.getAddPassphrase(encryptionObj, executingTOMA);

			break;
		case consts.volumeEncryptionCommands.DELETE_PASSPHRASE:
			encryptionMessage = scope.getDeletePassphrase(encryptionObj, executingTOMA);

			break;
		case consts.volumeEncryptionCommands.ROTATE_PASSPHRASE:
			encryptionMessage = scope.getRotatePassphrase(encryptionObj, executingTOMA);

			break;
	}

	kafkaModule.sendMessages(
		executingTOMA.topics[consts.topicSuffix.TOMA_COMMANDS],
		[encryptionMessage],
		cb
	);
};

scope.getAddPassphrase = (encryptionObj, executingTOMA) => {
	return new AddPassphrase(
		executingTOMA._id,
		executingTOMA.bootTime,
		encryptionObj._id,
		encryptionObj.uuid,
		encryptionObj.encryptionCommandIndex,
		encryptionObj.currentPassphrase,
		encryptionObj.newPassphrase,
		encryptionObj.slot
	);
};

scope.getDeletePassphrase = (encryptionObj, executingTOMA) => {
	return new DeletePassphrase(
		executingTOMA._id,
		executingTOMA.bootTime,
		encryptionObj._id,
		encryptionObj.uuid,
		encryptionObj.encryptionCommandIndex,
		encryptionObj.currentPassphrase
	);
};

scope.getRotatePassphrase = (encryptionObj, executingTOMA) => {
	return new AddPassphrase(
		executingTOMA._id,
		executingTOMA.bootTime,
		encryptionObj._id,
		encryptionObj.uuid,
		encryptionObj.encryptionCommandIndex,
		encryptionObj.currentPassphrase,
		encryptionObj.newPassphrase,
		encryptionObj.slot,
		consts.kafkaMessageTypes.ManagementToTOMA.rotatePassphrase
	);
};

scope.getInitEncryptionMessage = (encryptionObj, executingTOMA) => {
	return new InitEncryption(
		executingTOMA._id,
		executingTOMA.bootTime,
		encryptionObj._id,
		encryptionObj.uuid,
		encryptionObj.encryptionCommandIndex,
		encryptionObj.passphrase,
		encryptionObj.slot,
		encryptionObj.keySize
	);
};

scope.updateLastCommandSent = (uuid, commandIndex, command, cb) => {
	let db = app.get('db');
	let volumeCollection = db.collection('volume');

	let $query = {
		uuid: uuid,
		'encryption.command.commandIndex': commandIndex
	};

	let $update = {
		$set: {
			'encryption.command.status': consts.encryptionCommandStatuses.SENT,
			'encryption.lastMessageSent': {
				type: command,
				commandIndex: commandIndex
			}
		}
	};

	volumeCollection.findOneAndUpdate($query, $update, (err) => {
		if (err)
			return cb(new MongoError(err).log());

		cb();
	});
};

scope.handleCommandResponse = (encryptionResponse, cb) => {
	const db = app.get('db');
	const volumeCollection = db.collection('volume');
	const { volumeName, volumeUUID, encryptionCommandIndex, result, retryable, error } = encryptionResponse.payload;
	let isInitialized = false, errorResponse;

	switch (result) {
		case consts.encryptionCommandResults.SUCCESS:
			isInitialized = true;
			break;
		case consts.encryptionCommandResults.MANUAL_INTERVENTION_REQUIRED:
			errorResponse = systemMessages.ENCRYPTION_MANUAL_INTERVENTION_REQUIRED.message;
			break;
		case consts.encryptionCommandResults.TOMA_ERROR:
			errorResponse = systemMessages.ENCRYPTION_TOMA_ERROR.message;
			break;
		case consts.encryptionCommandResults.EXTERNAL_ERROR:
			errorResponse = systemMessages.ENCRYPTION_EXTERNAL_ERROR.message;
			break;
	}

	const commandResponse = {
		result,
		retryable,
		commandIndex: encryptionCommandIndex
	};

	if (errorResponse) {
		commandResponse.error = `${errorResponse} - ${error}`;
	}

	const $query = {
		uuid: volumeUUID,
		'encryption.lastMessageSent.commandIndex': encryptionCommandIndex,
		$or: [
			{ 'encryption.command.response': { $exists: 0 } },
			{ 'encryption.command.response.commandIndex': { $lt: encryptionCommandIndex } }
		]
	};

	const $set = {
		'encryption.command.status': consts.encryptionCommandStatuses.EXECUTED,
		'encryption.command.response': commandResponse,
	};

	if (isInitialized) {
		$set['encryption.isInitialized'] = isInitialized;
		$set.isReady = isInitialized;
	}

	volumeCollection.findOneAndUpdate($query, { $set }, { returnDocument: consts.mongoReturnDocument.AFTER }, (err, volume) => {
		if (err)
			new MongoError(err).log();

		const finish = (v) => {
			if (v) volumeModule.calculateAndUpdateVolumeStatus(v._id, v, cb);
			else cb();
		};

		if (volume) {
			if (errorResponse) {
				const systemMsg = new SystemAdminMessage(systemMessages.VOLUME_ENCRYPTION_COMMAND_FAILED)
					.addInfo(Entities.Volume.ID, volume._id)
					.addInfo(Entities.Error, `${errorResponse} - ${error}`)
					.addInfo(Entities.ErrorCode, result);

				if (volume.encryption.command.commandIndex === encryptionCommandIndex) {
					systemMsg.addInfo(Entities.Volume.encryptionCommand, volume.encryption.command.name);
				}
				systemMsg.log();
			}

			// TPV auto-attach teardown: encryption is done (success or error),
			// so release the TPV from the TOMA it was attached to for the run.
			// Also clears the marker so recovery doesn't re-detach on restart.
			// Pass null volume to the final status calc so it re-reads — the
			// detach has mutated tpvConfig.exclusiveClient / reservation fields
			// and the local `volume` snapshot is now stale.
			const tomaId = volume.encryption && volume.encryption.command && volume.encryption.command.tpvAutoAttachedTOMA;
			if (tomaId && volume.volumeClass === consts.volumeClass.TPV) {
				scope.detachTPVFromTOMAForEncryption(volume._id, tomaId, () => {
					volumeCollection.findOneAndUpdate(
						{ _id: volume._id },
						{ $unset: { 'encryption.command.tpvAutoAttachedTOMA': 1 } },
						(uerr) => {
							if (uerr) new MongoError(uerr).log();
							volumeModule.calculateAndUpdateVolumeStatus(volume._id, null, cb);
						}
					);
				});
			} else {
				finish(volume);
			}
		} else {
			logger.sysDEBUG(`Volume with matching last message command index was not found.
			volumeName: ${volumeName}, command index: ${encryptionCommandIndex}`);
			cb();
		}
	});
};

scope.setEncryptionCommand = (volume, command, executingTOMA, cb) => {
	const db = app.get('db');
	const volumeCollection = db.collection('volume');

	const $query = {
		uuid: volume.uuid,
		$or: [
			{ 'encryption.command.status': { $exists: false } },
			{ 'encryption.command.status': { $in: [consts.encryptionCommandStatuses.NONE, consts.encryptionCommandStatuses.EXECUTED] } }
		]
	};

	const $update = {};

	$update.$inc = { 'encryption.command.commandIndex': 1 };
	$update.$set = {
		'encryption.command.name': command,
		'encryption.command.executingTOMA': executingTOMA._id,
		'encryption.command.bootTime': executingTOMA.bootTime,
		'encryption.command.status': consts.encryptionCommandStatuses.PENDING_SEND
	};
	// For TPVs management auto-attaches the TPV to the chosen TOMA so the
	// encryption can run on /dev/nvmesh-tpv/<name>. Record the TOMA ID so
	// handleCommandResponse (and startup recovery) can drive the symmetric
	// detach. Absent on regular volumes.
	if (volume.volumeClass === consts.volumeClass.TPV) {
		$update.$set['encryption.command.tpvAutoAttachedTOMA'] = executingTOMA._id;
	}

	$update.$unset = {
		'encryption.command.response': 1
	};

	volumeCollection.findOneAndUpdate($query, $update, { returnDocument: consts.mongoReturnDocument.AFTER }, (err, volume) => {
		if (err)
			return cb(new MongoError(err).log());

		if (!volume)
			return cb(new SystemMessage(systemMessages.SET_ENCRYPTION_COMMAND_FAILED));

		volumeModule.calculateAndUpdateVolumeStatus(volume._id, volume, () => {
			cb(null, volume);
		});
	});
};

scope.acknowledgeResponseError = (volume, cb) => {
	const db = app.get('db');
	const volumeCollection = db.collection('volume');

	const $query = {
		uuid: volume.uuid,
		'encryption.command.commandIndex': volume.encryption.command.commandIndex
	};

	const $set = {
		'encryption.command.response.acknowledged': true,
	};

	volumeCollection.findOneAndUpdate($query, { $set }, { returnDocument: consts.mongoReturnDocument.AFTER }, (err, dbVolume) => {
		if (err)
			new MongoError(err).log();

		let sysMsg;
		if (!dbVolume) {
			sysMsg = new SystemAdminMessage(systemMessages.ENCRYPTION_RESPONSE_ACKNOWLEDGE_FAILED);
		} else {
			sysMsg = new SystemAdminMessage(systemMessages.ENCRYPTION_RESPONSE_ACKNOWLEDGE_SUCCESS);
		}
		sysMsg
			.addInfo(Entities.Volume.ID, volume._id)
			.addInfo(Entities.Volume.UUID, volume.uuid);
		cb(sysMsg);
	});

};

scope.handleEncryptionAcknowledgeResponseError = (encryptionObjs, cb) => {
	const messages = [];

	async.eachSeries(encryptionObjs, (encryptionObj, callback) => {
		scope.acknowledgeResponseError(encryptionObj, message => {
			messages.push(message);

			callback();
		});
	}, () => {
		cb(messages);
	});
};

scope.handleEncryptionRequests = (encryptionObjs, command, cb) => {
	const messages = [];

	async.eachSeries(encryptionObjs, (encryptionObj, callback) => {
		scope.runEncryptionCommand(encryptionObj, command, message => {
			messages.push(message);

			callback();
		});
	}, () => {
		cb(messages);
	});
};

scope.verifyEncryptionCommand = (volume, encryptionCommand) => {
	if (!volume.isEncrypted)
		return new SystemMessage(systemMessages.VOLUME_MISSING_IS_ENCRYPTED);

	function createSysMessageWithInfo(sysMsgType) {
		return new SystemMessage(sysMsgType).addInfo(Entities.Volume.ID, volume._id)
			.addInfo(Entities.Volume.UUID, volume.uuid);
	}

	switch (encryptionCommand) {
		case consts.volumeEncryptionCommands.INIT_ENCRYPTION:
			if (volume.encryption.isInitialized)
				return createSysMessageWithInfo(systemMessages.ENCRYPTION_ALREADY_INITIALIZED);

			if (volume.action != consts.volumeActions.INIT_ENCRYPTION_REQUIRED)
				return createSysMessageWithInfo(systemMessages.VOLUME_NOT_READY_FOR_INIT_ENCRYPTION);
			break;
		case consts.volumeEncryptionCommands.ADD_PASSPHRASE:
		case consts.volumeEncryptionCommands.DELETE_PASSPHRASE:
		case consts.volumeEncryptionCommands.ROTATE_PASSPHRASE:
			if (!volume.encryption.isInitialized)
				return createSysMessageWithInfo(systemMessages.VOLUME_ENCRYPTION_NOT_INITIALIZED);
			break;
	}
};


// TPV encryption runs on a TOMA that the chosen TOMA node has attached as if
// it were a regular client: preempt+EXCLUSIVE_READ_WRITE on the TPV, so
// /dev/nvmesh-tpv/<name> exists on the TOMA node and cryptsetup can run
// against it directly. After the encryption response arrives (handleCommandResponse),
// management detaches the TPV so the real client can reattach.
//
// Implementation detail: the TOMA's hostname is used as the clientID for the
// attach; the TOMA's node runs the nvmesh client kernel module just like a
// regular client and will have a matching 'client' document (registered on
// first connect). attachTPV looks up that doc to get the clientUUID.
scope.attachTPVToTOMAForEncryption = (dbVolume, executingTOMA, cb) => {
	const db = app.get('db');
	const clientCollection = db.collection('client');

	clientCollection.findOne({ _id: executingTOMA._id }, { projection: { uuid: 1 } }, (err, clientDoc) => {
		if (err) return cb(new MongoError(err).log());
		if (!clientDoc || !clientDoc.uuid) {
			return cb(new SystemMessage(systemMessages.GET_EXECUTING_TOMA_FOR_ENCRYPTION_FAILURE)
				.addInfo(Entities.Volume.ID, dbVolume.name)
				.addInfo(Entities.Error, `TOMA node ${executingTOMA._id} is not registered as a client; cannot attach TPV for encryption`));
		}

		// Do NOT pass syncFlush — attachTPV's applySyncFlush step unconditionally
		// persists the TPV's sourceUUID. The default (syncFlush !== false) keeps
		// sync_flush on, matching what real client attaches do. Passing false
		// here would flip the TPV to async-flush during the encryption window
		// and leave it that way after detach.
		//
		// allowNonReady: true bypasses the isReady check in attachVolumes /
		// getVolumesConfigurationForClient. A newly created encrypted TPV has
		// isReady=false (flipped to true only after initEncryption completes),
		// so without this bypass attachTPV silently filters it out and no
		// attachVolumes Kafka is sent to the TOMA — the later waitForTPV then
		// times out with "attachment not confirmed".
		clientModule.attachTPV(executingTOMA._id, clientDoc.uuid, dbVolume._id, { preempt: true, allowNonReady: true }, (attachErr) => {
			// attachTPV's internal steps frequently swallow errors into logs and
			// call back without arg, so attachErr may be null even on partial
			// failure. Authoritative check: re-read the TPV and verify
			// tpvConfig.exclusiveClient matches the TOMA we asked to attach to.
			const volumeCollection = db.collection('volume');
			volumeCollection.findOne({ _id: dbVolume._id, volumeClass: consts.volumeClass.TPV }, (err2, tpv) => {
				if (err2) return cb(new MongoError(err2).log());
				if (!tpv || !tpv.tpvConfig || tpv.tpvConfig.exclusiveClient !== executingTOMA._id) {
					const msg = new SystemMessage(systemMessages.RUN_ENCRYPTION_COMMAND_FAILED)
						.addInfo(Entities.Volume.ID, dbVolume.name)
						.addInfo(Entities.Target.executingTOMA, executingTOMA._id)
						.addInfo(Entities.Error, 'TPV attach to TOMA for encryption did not complete');
					if (attachErr) msg.addInfo(Entities.Error, attachErr);
					return cb(msg);
				}
				// Wait for the TOMA's client kernel to confirm the TPV attach.
				// attachTPV fires-and-forgets the attachVolumes Kafka; the TOMA
				// processes it asynchronously and sends updateAttachmentStatus back.
				// Sending initEncryption before that confirmation races and causes
				// "Volume doesn't exist" on the TOMA (its block_devices_hash_by_uuid
				// hasn't been populated yet). Poll until the attachment action leaves
				// 'attaching' state (cleared when updateAttachmentStatus is received).
				scope.waitForTPVAttachedOnTOMA(tpv.uuid, executingTOMA._id, (waitErr) => {
					if (waitErr) {
						return cb(new SystemMessage(systemMessages.RUN_ENCRYPTION_COMMAND_FAILED)
							.addInfo(Entities.Volume.ID, dbVolume.name)
							.addInfo(Entities.Target.executingTOMA, executingTOMA._id)
							.addInfo(Entities.Error, waitErr.message || waitErr));
					}
					cb();
				});
			});
		});
	});
};

// Poll the client document until the TPV attachment on the TOMA is confirmed
// by the client kernel's updateAttachmentStatus heartbeat.
//
// Key insight from client.js:1128-1164: `attachments[uuid].action` is
// management's WISHFUL state (what mgmt wants — attaching / detaching /
// reattaching). It's set when mgmt decides to attach and is NEVER cleared
// by a successful confirmation — the volume can be fully attached and the
// action field will still say 'attaching'.  The authoritative signal that
// the TOMA's client kernel actually owns the volume (and /dev/nvmesh-tpv/<name>
// is live) is an entry in the client's `block_devices` array with
// `vol_status === ATTACHED` (consts.volumeAttachmentStatus.ATTACHED = 4).
// That entry is only written once the client kernel sends updateAttachmentStatus
// reporting the successful attach (client.js::updateAttachmentStatus_handler).
scope.waitForTPVAttachedOnTOMA = (tpvUuid, tomaId, cb) => {
	const db = app.get('db');
	const clientCollection = db.collection('client');
	const POLL_INTERVAL_MS = 300;
	const MAX_WAIT_MS = 30000;
	const deadline = Date.now() + MAX_WAIT_MS;

	function poll() {
		clientCollection.findOne(
			{ _id: tomaId },
			{ projection: { block_devices: 1, [`attachments.${tpvUuid}`]: 1 } },
			(err, doc) => {
				if (err) return cb(new MongoError(err).log());
				const bdev = (doc && Array.isArray(doc.block_devices))
					? doc.block_devices.find(b => b && b.uuid === tpvUuid)
					: null;
				const attachment = doc && doc.attachments && doc.attachments[tpvUuid];
				const action = attachment && attachment.action;

				// Confirmed: client kernel reported the volume attached.
				if (bdev && bdev.vol_status === consts.volumeAttachmentStatus.ATTACHED) return cb();

				// Explicit attach-failure states.
				if (bdev && [
					consts.volumeAttachmentStatus.ATTACH_FAILED,
					consts.volumeAttachmentStatus.VOLUME_RESERVATION_DENIED,
				].includes(bdev.vol_status)) {
					return cb(new Error(`TPV ${tpvUuid} attach on TOMA ${tomaId} reported status=${consts.volumeAttachmentStatusToName[bdev.vol_status] || bdev.vol_status}`));
				}

				// Management changed its mind after we started — treat as failure.
				if (action === consts.volumeAttachmentActions.DETACHING ||
				    action === consts.volumeAttachmentActions.DETACHING_STALE) {
					return cb(new Error(`TPV ${tpvUuid} unexpectedly in '${action}' state on TOMA ${tomaId}`));
				}

				// Still pending (bdev absent, or bdev.vol_status ∈ {BUSY, ATTACHING}).
				if (Date.now() >= deadline) {
					const status = bdev ? (consts.volumeAttachmentStatusToName[bdev.vol_status] || bdev.vol_status) : 'no block_devices entry';
					return cb(new Error(`Timeout: TPV ${tpvUuid} attachment not confirmed on TOMA ${tomaId} after ${MAX_WAIT_MS}ms (vol_status=${status}, action=${action || 'absent'})`));
				}

				setTimeout(poll, POLL_INTERVAL_MS);
			}
		);
	}
	poll();
};

scope.detachTPVFromTOMAForEncryption = (tpvName, tomaId, cb) => {
	const db = app.get('db');
	const clientCollection = db.collection('client');

	clientCollection.findOne({ _id: tomaId }, { projection: { uuid: 1 } }, (err, clientDoc) => {
		if (err) { new MongoError(err).log(); return cb(); }
		if (!clientDoc || !clientDoc.uuid) {
			logger.sysDEBUG(`detachTPVFromTOMAForEncryption: TOMA ${tomaId} client doc not found; nothing to detach`);
			return cb();
		}
		clientModule.detachTPV(tomaId, clientDoc.uuid, tpvName, () => cb());
	});
};

scope.runEncryptionCommand = (encryptionObj, command, cb) => {
	let db = app.get('db');
	let volumeCollection = db.collection('volume');

	let dbVolume;
	let executingTOMA;
	// Tracks whether the TPV auto-attach step succeeded. If the Kafka command
	// is then sent successfully, TOMA owns completion — the response will
	// drive detach via handleCommandResponse (and cleanupTPVAutoAttaches
	// AfterStartup picks up the pieces on a management crash). If the attach
	// succeeded but Kafka was never delivered (broker down, setEncryptionCommand
	// DB failure, etc.), the TPV would otherwise stay exclusively held by the
	// TOMA with no response coming, so the final callback must detach.
	let tpvAttached = false;
	let kafkaSent = false;

	async.series([
		//Fetch volume and verify
		(callback) => {
			volumeCollection.findOne({ uuid: encryptionObj.uuid }, (err, volume) => {
				if (err)
					return callback(new MongoError(err).log());

				if (!volume)
					return callback(new SystemMessage(systemMessages.VOLUME_NOT_FOUND));
				else {
					dbVolume = volume;

					let err = scope.verifyEncryptionCommand(dbVolume, command);

					if (err)
						return callback(err);

					callback();
				}
			});
		},
		(callback) => {
			scope.chooseTOMAForEncryption(dbVolume, (err, target) => {
				executingTOMA = target;

				callback(err);
			});
		},
		(callback) => {
			// TPV encryption prerequisite: attach the TPV to the chosen TOMA
			// node with preempt=true, mode=EXCLUSIVE_READ_WRITE so that
			// /dev/nvmesh-tpv/<name> exists on the TOMA and cryptsetup can
			// run against it. For non-TPV volumes this step is a no-op — the
			// TOMA uses the existing shadow-volume mechanism.
			if (!dbVolume || dbVolume.volumeClass !== consts.volumeClass.TPV) return callback();
			scope.attachTPVToTOMAForEncryption(dbVolume, executingTOMA, (err) => {
				if (!err) tpvAttached = true;
				callback(err);
			});
		},
		(callback) => {
			scope.setEncryptionCommand(
				dbVolume,
				command,
				executingTOMA,
				(err, volume) => {
					if (err)
						return callback(err);

					encryptionObj.encryptionCommandIndex = volume.encryption.command.commandIndex;

					callback();
				}
			);
		},
		(callback) => {
			scope.sendEncryptionCommandToTOMA(encryptionObj, command, executingTOMA, (err) => {
				if (!err) kafkaSent = true;
				callback(err);
			});
		},
		(callback) => {
			scope.updateLastCommandSent(
				encryptionObj.uuid,
				encryptionObj.encryptionCommandIndex,
				command,
				callback
			);
		}
	], (systemMessage) => {
		const deliver = () => {
			const message = new SystemAdminMessage(systemMessage ? systemMessages.RUN_ENCRYPTION_COMMAND_FAILED : systemMessages.RUN_ENCRYPTION_COMMAND_SUCCESS)
				.addInfo(Entities.Volume.ID, encryptionObj._id)
				.addInfo(Entities.Volume.UUID, encryptionObj.uuid);

			if (!systemMessage || executingTOMA)
				message.addInfo(Entities.Target.executingTOMA, executingTOMA._id);

			if (systemMessage)
				message.addInfo(Entities.Error, systemMessage);

			cb(message);
		};

		// Intra-call detach-on-failure: if the TPV was attached for encryption
		// but the command never reached TOMA (Kafka send error, upstream DB
		// failure), the TOMA-side encryption will never run and no response
		// will arrive — handleCommandResponse's detach path will never fire.
		// Release the TPV here so the real client can reattach.
		//
		// IMPORTANT: only detach when !kafkaSent. If Kafka was delivered, TOMA
		// is actively running cryptsetup against /dev/nvmesh-tpv/<name>;
		// detaching here would yank the block device out from under cryptsetup.
		// In that case let handleCommandResponse (on response arrival) or
		// cleanupTPVAutoAttachesAfterStartup (on management restart) drive the
		// detach.
		if (systemMessage && tpvAttached && !kafkaSent && executingTOMA && dbVolume) {
			scope.detachTPVFromTOMAForEncryption(dbVolume._id, executingTOMA._id, () => {
				// Also clear any tpvAutoAttachedTOMA stamp (setEncryptionCommand
				// may have set it before the failure). Best-effort; if the
				// field was never stamped this is a no-op.
				volumeCollection.updateOne(
					{ _id: dbVolume._id },
					{ $unset: { 'encryption.command.tpvAutoAttachedTOMA': 1 } },
					() => deliver()
				);
			});
		} else {
			deliver();
		}
	});
};

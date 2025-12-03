/***************************************************************************
 * Copyright (C) 2015-2020 Excelero, Inc. All Rights Reserved.
 *
 * This file is part of Excelero NVMesh software.
 *
 * Unauthorized copying of this file, via any medium is strictly prohibited
 * Proprietary and confidential
 ****************************************************************************/

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
const { InitEncryption } = require('../models/kafkaMessages/InitEncryption');
const { RequestEncryptionResponse } = require('../models/kafkaMessages/RequestEncryptionResponse');
const { AddPassphrase } = require('../models/kafkaMessages/AddPassphrase.js');
const { DeletePassphrase } = require('../models/kafkaMessages/DeletePassphrase.js');


scope.afterModuleLoaded = () => {
	({ Entities, SystemMessage, MongoError, SystemAdminMessage } = require('./error.js'));
};

scope.chooseTOMAForEncryption = (volume, callback) => {
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

			volumeModule.calculateAndUpdateVolumeStatus(volume._id, volume, cb);
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


scope.runEncryptionCommand = (encryptionObj, command, cb) => {
	let db = app.get('db');
	let volumeCollection = db.collection('volume');

	let dbVolume;
	let executingTOMA;

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
			scope.sendEncryptionCommandToTOMA(encryptionObj, command, executingTOMA, callback);
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
		const message = new SystemAdminMessage(systemMessage ? systemMessages.RUN_ENCRYPTION_COMMAND_FAILED : systemMessages.RUN_ENCRYPTION_COMMAND_SUCCESS)
			.addInfo(Entities.Volume.ID, encryptionObj._id)
			.addInfo(Entities.Volume.UUID, encryptionObj.uuid);

		if (!systemMessage || executingTOMA)
			message.addInfo(Entities.Target.executingTOMA, executingTOMA._id);

		if (systemMessage)
			message.addInfo(Entities.Error, systemMessage);

		cb(message);
	});
};

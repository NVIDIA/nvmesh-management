/*
 * SPDX-FileCopyrightText: Copyright (c) 2026 NVIDIA CORPORATION & AFFILIATES. All rights reserved.
 * SPDX-License-Identifier: Apache-2.0
 */

/* global */
var logger = require('../logger.js');

var targetModule = require('./target.js');
var diskModule = require('./disk.js');
var volumeModule = require('./volume.js');
var consts = require('../consts.js');
var clientModule = require('./client.js');
var upgradeAgentModule = require('./upgradeAgent.js');

var configurationProfileModule = require('./configurationProfiles.js');

var { logMessage } = require('./lastMessageLog.js');

var { MessageFromTOMA } = require('../models/kafkaMessages/MessageFromTOMA');
const { MessageFromClient } = require('../models/kafkaMessages/MessageFromClient.js');
const { MessageFromAgent } = require('../models/kafkaMessages/MessageFromAgent.js');
const { MessageFromUpgradeAgent } = require('../models/kafkaMessages/MessageFromUpgradeAgent.js');
const { Entities, SystemMessage } = require('./error.js');
const systemMessages = require('../systemMessages.js');
const volumeEncryptionModule = require('./volumeEncryption');

exports.afterModuleLoaded = () => {
	logger = require('../logger');
};

exports.routeMessage = function(kafkaMessage, topic, partition, offset, callback) {
	let message;
	logger.sysDEBUG(`Received ${kafkaMessage.messageType} on topic ${topic} partition ${partition} offset ${offset} from `
		+ `${kafkaMessage.originType} ${kafkaMessage.hostname || kafkaMessage.clientID}`, kafkaMessage);

	switch (kafkaMessage.originType) {
		case consts.originTypes.TOMA:
			message = new MessageFromTOMA(kafkaMessage.messageType, kafkaMessage.messageTypeVersion, kafkaMessage);
			logMessage(message);
			routeTOMAMessage(message, getRouteMessageCallbackFunction(message, callback));
			break;

		case consts.originTypes.CLIENT:
			message = new MessageFromClient(kafkaMessage.messageType, kafkaMessage.messageTypeVersion, kafkaMessage);
			logMessage(message);
			routeClientMessage(message, getRouteMessageCallbackFunction(message, callback));
			break;

		case consts.originTypes.MANAGEMENT_AGENT:
			message = new MessageFromAgent(kafkaMessage.messageType, kafkaMessage.messageTypeVersion, kafkaMessage);
			logMessage(message);
			routeAgentMessage(message, getRouteMessageCallbackFunction(message, callback));
			break;

		case consts.originTypes.UPGRADE_AGENT:
			message = new MessageFromUpgradeAgent(kafkaMessage.messageType, kafkaMessage.messageTypeVersion, kafkaMessage);
			logMessage(message);
			routeUpgradeAgentMessage(message, getRouteMessageCallbackFunction(message, callback));
			break;

		default:
			new SystemMessage(systemMessages.KAFKA_UNSUPPORTED_ORIGIN_TYPE)
				.addInfo(Entities.KafkaMessage.originType, kafkaMessage.originType)
				.log();

			return callback();
	}

	if (!message.type) {
		new SystemMessage(systemMessages.KAFKA_MESSAGE_WITHOUT_MESSAGE_TYPE)
			.addInfo(Entities.KafkaMessage, message.toJSON())
			.log();

		return callback();
	}
};

/**
 * @param {MessageFromAgent} message
 */
function routeAgentMessage(message, callback) {
	var msgType = consts.kafkaMessageTypes.AgentToManagement;

	switch (message.type) {
		case msgType.keepalive: {
			clientModule.handleAgentKeepAlive(message, callback);
			break;
		}
		case msgType.configProfileUpdated: {
			configurationProfileModule.nodeConfigurationApplied(message.clientID, message.payload.configProfileInfo, callback);
			break;
		}
		case msgType.updateConfigProfileUserOverride: {
			configurationProfileModule.setUserOverride(message.clientID, message.payload.configProfileInfo, 0, callback);
			break;
		}
		case msgType.updateKeys: {
			clientModule.updateClientKeys(message.payload.keys, message.clientID, callback);
			break;
		}
		default: {
			new SystemMessage(systemMessages.KAFKA_UNKNOWN_MESSAGE_TYPE)
				.addInfo(Entities.KafkaMessage.messageType, message.type)
				.addInfo(Entities.KafkaMessage.originType, message.originType)
				.log();

			callback();
		}
	}
}

/**
 * @param {MessageFromClient} message
 */
function routeClientMessage(message, callback) {
	var msgType = consts.kafkaMessageTypes.ClientToManagement;

	switch (message.type) {
		case msgType.keepalive: {
			clientModule.handleClientKeepalive(message, callback);
			break;
		}
		case msgType.updateAttachmentStatus: {
			clientModule.handleUpdateAttachment(message, callback);
			break;
		}
		case msgType.log: {
			clientModule.handleClientLogRequest(message, callback);
			break;
		}
		case msgType.updateLog: {
			clientModule.handleClientUpdateLogRequest(message, callback);
			break;
		}
		case msgType.ackLog: {
			clientModule.handleClientAckLogRequest(message, callback);
			break;
		}
		case msgType.getTargetNICs: {
			clientModule.handleGetTargetNICs(message, callback);
			break;
		}
		default: {
			new SystemMessage(systemMessages.KAFKA_UNKNOWN_MESSAGE_TYPE)
				.addInfo(Entities.KafkaMessage.messageType, message.type)
				.addInfo(Entities.KafkaMessage.originType, message.originType)
				.log();

			callback();
		}
	}
}

/**
 * @param {MessageFromTOMA} message
 */
function routeTOMAMessage(message, callback) {
	var tomaMsgType = consts.kafkaMessageTypes.TOMAToManagament;

	switch (message.type) {
		case tomaMsgType.keepalive:
			targetModule.handleKeepAlive(message, callback);
			break;

		case tomaMsgType.leaderKeepalive:
			targetModule.handleLeaderKeepAlive(message, callback);
			break;

		case tomaMsgType.reportTarget:
			targetModule.report(message, callback);
			break;

		case tomaMsgType.updatePRaidReport:
		case tomaMsgType.sendPRaidReportResponse:
			volumeModule.handlePRaidStatusMessage(message, callback);
			break;

		case tomaMsgType.driveZeroingProgress:
			diskModule.updateDriveZeroingProgress(message);
			callback();
			break;

		case tomaMsgType.segmentZeroingProgress:
			volumeModule.updateSegmentZeroingProgress(message);
			callback();
			break;

		case tomaMsgType.updateDiskSegmentsDirtyBits:
			volumeModule.updateDiskSegmentsDirtyBits(message, callback);
			break;

		case tomaMsgType.encryptionCommandResponse:
			volumeEncryptionModule.handleCommandResponse(message, callback);
			break;

		default:
			new SystemMessage(systemMessages.KAFKA_UNKNOWN_MESSAGE_TYPE)
				.addInfo(Entities.KafkaMessage.messageType, message.type)
				.addInfo(Entities.KafkaMessage.originType, message.originType)
				.log();

			callback();
	}
}

/**
 * @param {MessageFromUpgradeAgent} message
 */
function routeUpgradeAgentMessage(message, callback) {
	var msgType = consts.kafkaMessageTypes.UpgradeAgentToManagement;

	switch (message.type) {
		case msgType.keepalive: {
			upgradeAgentModule.handleKeepAlive(message, callback);
			break;
		}
		case msgType.commandResult: {
			upgradeAgentModule.handleCommandResult(message, callback);
			break;
		}
		default: {
			new SystemMessage(systemMessages.KAFKA_UNKNOWN_MESSAGE_TYPE)
				.addInfo(Entities.KafkaMessage.messageType, message.type)
				.addInfo(Entities.KafkaMessage.originType, message.originType)
				.log();

			callback();
		}
	}
}

function getRouteMessageCallbackFunction(message, callback) {
	return (err) => {
		if (err) {
			let systemMessage = new SystemMessage(systemMessages.KAFKA_MESSAGE_COMPLETION_WITH_ERROR)
				.addInfo(Entities.KafkaMessage.originType, message.originType)
				.addInfo(Entities.KafkaMessage.messageType, message.type)
				.addInfo(Entities.Error, err);

			if (message instanceof MessageFromTOMA)
				systemMessage.addInfo(Entities.Target.ID, message.hostname);
			else
				systemMessage.addInfo(Entities.Client.ID, message.clientID);

			systemMessage.log();
		}

		let ignoreError = message instanceof MessageFromAgent || message instanceof MessageFromClient;

		callback(!ignoreError && err);
	};
}

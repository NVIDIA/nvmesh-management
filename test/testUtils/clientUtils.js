/*
 * SPDX-FileCopyrightText: Copyright (c) 2026 NVIDIA CORPORATION & AFFILIATES. All rights reserved.
 * SPDX-License-Identifier: Apache-2.0
 */

const { volumeAttachmentStatus, volumeAttachmentActions, kafkaMessageTypes } = require('../../consts');
const { attachVolumes, attachSnapshot, handleUpdateAttachment, detachVolumes } = require('../../modules/client');
const { Entities } = require('../../modules/error');
const { BlockDevice } = require('../models/client');

const assert = require('assert');
const { ClientKeepAliveBuilder, ClientUpdateAttachmentStatusBuilder } = require('../kafkaMessages/fromClient/clientMessageBuilders.js');
const { AgentKeepAliveBuilder } = require('../kafkaMessages/fromAgent/agentKeepAlive.js');
const { sendMessageToManagement } = require('../kafkaMessages/sendMessage.js');


exports.promiseAttachVolume = async function(clientID, clientUUID, volume) {
	return new Promise((resolve, reject) => {
		let volumes = [volume];
		if (Array.isArray(volume))
			volumes = volume;
		attachVolumes(clientID, clientUUID, volumes, messages => {
			const responses = messages.map(l => l.createApiResponse(Entities.Volume.ID, Entities.Volume.UUID));
			if (!responses[0].success)
				return reject(new Error(JSON.stringify(responses[0].error)));
			resolve(responses);
		});
	});
};

exports.promiseDetachVolume = async function(clientID, clientUUID, volume) {
	return new Promise((resolve, reject) => {
		let volumes = [volume];
		if (Array.isArray(volume))
			volumes = volume;
		detachVolumes(clientID, clientUUID, volumes, messages => {
			const responses = messages.map(l => l.createApiResponse(Entities.Volume.ID, Entities.Volume.UUID));
			if (!responses[0].success)
				return reject(new Error(`Detach client failed: ${JSON.stringify(responses[0].error)}`));
			resolve(responses);
		});
	});
};

exports.promiseAttachSnapshot = async function(snapshot, clientID, clientUUID, isRecovery = false) {
	return new Promise((resolve, reject) => {
		attachSnapshot(snapshot, clientID, clientUUID, message => {
			const response = message.createApiResponse(Entities.Volume.ID, Entities.Volume.UUID);
			if (!response.success)
				return reject(new Error(JSON.stringify(response.error)));
			resolve();
		}, isRecovery);
	});
};

/***
 * This method will send UpdateAttachmentStatus to the management for each volume in ConfigurationResponse
 * @confRespMessage [SendConfigurationResponse] SendConfigurationResponse message recieved from management
 * @client [Client] The test Client model
 *  */
exports.reportAttachOnConfigurationResponse = async function(confRespMessage, client) {
	let bdevs = [];
	client.attachmentsVersion = confRespMessage.payload.attachmentsVersion;

	confRespMessage.payload.volumes.forEach(async(volume) => {
		const volumeConf = volume.configuration;
		let bdev = new BlockDevice(volumeConf._id)
			.setUUID(volumeConf.uuid);
		bdev.reservation = { ...volumeConf.reservation };
		bdev.vol_action = volumeConf.action;
		bdev.uuid = volumeConf.uuid;

		client.addBlockDevice(bdev);
		bdevs.push(bdev);
	});

	let promise = client.sendUpdateAttachmentMessage(bdevs);
	return promise;
};

/***
 * This method will send UpdateAttachmentStatus to the management for each volume in DetachVolumes Message
 * @detachVolumesMsg [DetachVolumes] DetachVolumes message recieved from management
 * @client [Client] The test Client model
 *  */
exports.reportDetachedOnDetachVolume = async function(detachVolumesMsg, client) {
	// simulate client updateAttachamentStatus message with volumes detached
	client.attachmentsVersion = detachVolumesMsg.attachmentsVersion;
	let clientBlockDevices = {};
	client.block_devices.forEach(b => clientBlockDevices[b.name] = b);

	let bdevsToReport = [];
	detachVolumesMsg.volumes.forEach(vol => {
		clientBlockDevices[vol.name].vol_status = volumeAttachmentStatus.DETACHED;
		bdevsToReport.push(clientBlockDevices[vol.name]);
	});

	// remove detached from client
	//client.block_devices = client.block_devices.filter(b => b.vol_status == volumeAttachmentStatus.ATTACHED);

	// Send Message
	let promise = client.sendUpdateAttachmentMessage(bdevsToReport);
	return promise;
};


exports.promiseHandleUpdateAttachment = function(msg) {
	return new Promise((resolve, reject) => {
		handleUpdateAttachment(msg, err => {
			if (err)
				return reject(err);

			resolve();
		});
	});
};

exports.getSingleAttachmentStatusMsg = function(client, vol, status) {
	let bdevReport = new BlockDevice(vol._id)
		.setUUID(vol.uuid)
		.setAction(volumeAttachmentActions.ATTACHING)
		.setStatus(status);

	client.reportID++;
	let updateAttachmentMsg = ClientUpdateAttachmentStatusBuilder.fromClient(client)
		.addAttachment(bdevReport)
		.build();

	return updateAttachmentMsg;
};

async function waitAndHandleUpdateTokenMsg(client, waitForMessageTypeFn, messageType, tokenName, messageSequenceName) {
	let msg = await client[waitForMessageTypeFn](messageType);
	assert(msg, 'expected new token message to be sent');

	client[tokenName] = msg.payload.token || msg.payload.clientToken;
	client[messageSequenceName] = msg.payload.messageSequence;
	return msg;
}

async function waitAndHandleAgentUpdateTokenMsg(client) {
	return await waitAndHandleUpdateTokenMsg(client, 'waitForAgentMessageType',
		kafkaMessageTypes.ManagementToAgent.updateAgentToken, 'mgmtAgentToken', 'agentMessageSequence');
}

async function waitAndHandleClientUpdateTokenMsg(client) {
	return await waitAndHandleUpdateTokenMsg(client, 'waitForClientMessageType',
		kafkaMessageTypes.ManagementToClient.updateClientToken, 'clientToken', 'messageSequence');
}

function sendKeepaliveAndValidateTokenReceived(client, clientCollection, keepaliveBuilder, waitAndHandleUpdateTokenFn, expectedToken) {
	const keepAliveMsg = keepaliveBuilder.fromClient(client).build();

	return sendMessageToManagement(keepAliveMsg)
		.then(() => clientCollection.findOne({ _id: client.id }))
		.then(assert)
		.then(() => waitAndHandleUpdateTokenFn(client))
		.then(msg => assert.strictEqual(msg.payload.token || msg.payload.clientToken, expectedToken));
}

exports.sendAgentKeepaliveAndValidateTokenReceived = function(client, clientCollection, expectedToken = 1) {
	return sendKeepaliveAndValidateTokenReceived(client, clientCollection, AgentKeepAliveBuilder, waitAndHandleAgentUpdateTokenMsg, expectedToken);
};

exports.sendClientKeepaliveAndValidateTokenReceived = function(client, clientCollection, expectedToken = 1) {
	return sendKeepaliveAndValidateTokenReceived(client, clientCollection, ClientKeepAliveBuilder, waitAndHandleClientUpdateTokenMsg, expectedToken);
};

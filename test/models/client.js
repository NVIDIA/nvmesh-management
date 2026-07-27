/* global app */

const moment = require('moment');
const { reservationModes, reservationModePreempts } = require('../../consts.js');
const consts = require('../../consts.js');
const { Entity } = require('./entity.js');
const uuid = require('uuid');
const { getClientMainTopic, getAgentMainTopic } = require('../../modules/kafka.js');
const { getOrCreateQueue, resetKafkaQueue } = require('../testUtils/mockKafkaModule.js');
const { sendMessageToManagement } = require('../kafkaMessages/sendMessage.js');
const { ClientUpdateAttachmentStatusBuilder, ClientKeepAliveBuilder } = require('../kafkaMessages/fromClient/clientMessageBuilders.js');
const { AgentKeepAliveBuilder } = require('../kafkaMessages/fromAgent/agentKeepAlive.js');
const { LastMessageLog } = require('./lastMessageLog.js');
const { handleTimedOutComponent } = require('../../modules/lastMessageLog.js');

const clientModule = require('../../modules/client.js');

class Client extends Entity {
	constructor(clientID) {
		super();
		this.id = clientID;
		this.block_devices = [];
		this.branch = 'unittest';
		this.clientID = clientID;
		this.client_status = 1;
		this.commit = 'fake-commit';
		this.configProfile = { version: 0, id: 'No-Profile', name: 'No Profile' };
		this.reportID = 1;
		this.version = '3.1.0-1269';
		this.featureCompatibilityVersion = 1;
		this.snapshotsStatus = [];
		this.attachments = {}; // wishful state as recieved from management
		this.clientToken = -1;
		this.mgmtAgentToken = -1;
		this.isUmClient = true;
		this.messageSequence = 1;
		this.agentMessageSequence = 1;
		this.attachmentsVersion = 0;

		this.originID = 'clientOriginID_' + this.id;
		this.agentOriginID = 'agentOriginID_' + this.id;
	}

	setClientToken(newToken) {
		this.clientToken = newToken;
	}

	setAgentToken(mgmtAgentToken) {
		this.mgmtAgentToken = mgmtAgentToken;
	}

	setAttachmentsVersion(attachmentsVersion) {
		this.attachmentsVersion = attachmentsVersion;
	}

	getReport() {
		return this.report;
	}

	sendUpdateAttachmentMessage(blockDevices) {
		this.reportID++;
		let updateAttachmentMsg = ClientUpdateAttachmentStatusBuilder.fromClient(this);
		blockDevices.forEach(bdev => updateAttachmentMsg.addAttachment(bdev));
		let msg = updateAttachmentMsg.build();
		return sendMessageToManagement(msg);
	}

	async save() {
		await this.agentStartup();
		await this.sendClientKeepAlive();

		// get new token
		let msg = await this.readMessageFromClientTopic();
		this.clientToken = msg.payload.clientToken;
		this.messageSequence = msg.payload.messageSequence + 1;
		this.reportID = msg.payload.reportID;

		// send Keepalive with new token
		await this.sendClientKeepAlive();

		const dbClient = await app.get('db').collection('client').findOne({ _id: this.id });
		this.uuid = dbClient.uuid;
	}

	getAttachmentsUUIDHash() {
		let mappedAttachments = Object.values(this.attachments).map(a => {
			return {
				uuid: a.uuid,
				action: consts.volumeAttachmentActions.ATTACHING,
				attachmentsVersion: a.attachmentsVersion
			};
		});
		return clientModule.calcAttachmentsUUIDHash({ attachments: mappedAttachments }, false);
	}

	getVolumeVersionsSum() {
		let versionSum = 0;
		Object.values(this.attachments).forEach(a => versionSum += a.version);
		return versionSum;
	}

	sendClientKeepAlive() {
		let clientKeepAliveMsg = ClientKeepAliveBuilder.fromClient(this).build();
		return sendMessageToManagement(clientKeepAliveMsg);
	}

	sendAgentKeepAlive() {
		let agentKeepAliveMsg = AgentKeepAliveBuilder.fromClient(this).build();
		return sendMessageToManagement(agentKeepAliveMsg);
	}

	async agentStartup() {
		// send keepalive messge and receive token
		await this.sendAgentKeepAlive();

		let msg = await this.readMessageFromAgentTopic();
		this.mgmtAgentToken = msg.payload.token;
		this.agentMessageSequence = msg.payload.messageSequence + 1;

		// send another keepalive with the updated token
		await this.sendAgentKeepAlive();
	}

	async getClientMainTopicName() {
		return await new Promise(resolve => {
			getClientMainTopic(this.id, resolve);
		});
	}

	async getAgentMainTopicName() {
		return await new Promise(resolve => {
			getAgentMainTopic(this.id, resolve);
		});
	}

	addBlockDevice(attachment, attachmentsVersion) {
		attachment.attachmentsVersion = attachmentsVersion;
		this.attachments[attachment.uuid] = attachment;
		this.block_devices.push(attachment);
	}

	async getClientQueue() {
		return getOrCreateQueue(await this.getClientMainTopicName());
	}

	async getAgentQueue() {
		return getOrCreateQueue(await this.getAgentMainTopicName());
	}

	async _waitForMessageType(queue, msgType, timeout = 30000) {
		let msg;
		while (msg?.type != msgType) {
			msg = await queue.readMessageOrWait(timeout);
		}

		return Promise.resolve(msg);
	}

	async waitForClientMessageType(msgType) {
		return await this._waitForMessageType(await this.getClientQueue(), msgType);
	}

	async waitForAgentMessageType(msgType) {
		return await this._waitForMessageType(await this.getAgentQueue(), msgType);
	}

	async readMessageFromClientTopic(timeoutMS) {
		let msg = await (await this.getClientQueue()).readMessageOrWait(timeoutMS);
		return msg;
	}

	async readMessageFromAgentTopic(timeoutMS) {
		let msg = await (await this.getAgentQueue()).readMessageOrWait(timeoutMS);
		return msg;
	}

	async resetClientQueue() {
		resetKafkaQueue(await this.getClientMainTopicName());
	}

	async resetAgentQueue() {
		resetKafkaQueue(await this.getAgentMainTopicName());
	}

	// simulate a timed out component
	timedOutClient() {
		return new Promise(resolve => {
			const tenMinsAgo = moment().subtract(10, 'minutes');
			const lastMessageLogDoc = new LastMessageLog(this.id, consts.originTypes.CLIENT,
				consts.kafkaMessageTypes.ClientToManagement.keepalive, this.messageSequence, this.clientToken, tenMinsAgo);

			handleTimedOutComponent(lastMessageLogDoc, resolve);
		});
	}
}

class ClientKeepAliveMessage {
	constructor(client) {
		this.route = '/clients/keepAlive',
		this.payload = {
			client: client
		};
	}
}

class GetConfigurationRequest {
	constructor() {
		this.route = '/clients/getConfiguration',
		this.payload = {
			cli_unique_id: 'AAAAAAAAAAAAAAA',
			volumes: [],
			'configurationVersion': 0
		};
	}

	addAttachmentRequest(attachmentRequest) {
		this.payload.volumes.push(attachmentRequest);
		return this;
	}
}

class BlockDevice {
	constructor(volumeID) {
		this.name = volumeID;
		this.uuid = uuid.v4();
		this.ioEnabled = 1,
		this.vol_status = consts.volumeAttachmentStatus.ATTACHED,
		this.vol_action = 0,
		this.version = 1,
		this.reservation = {
			preempt: reservationModePreempts.WEAK_PREEMPT,
			version: 1,
			mode: reservationModes.SHARED_READ_WRITE,
			is_512B_IO_allowed: 0
		},
		this.is_hidden = 0,
		this.io_perm = 15;
		this.attachmentsVersion = 0;
	}

	toString() {
		return JSON.stringify(this);
	}

	setUUID(uuid) {
		this.uuid = uuid;
		return this;
	}

	// set status: consts.volumeAttachmentStatus.ATTACHED, consts.volumeAttachmentStatus.DETACHED , etc..
	setStatus(status) {
		this.vol_status = status;
		return this;
	}

	setAction(action) {
		this.vol_action = action;
		return this;
	}

	setReservationVersion(reservationVersion) {
		this.reservation.version = reservationVersion;
		return this;
	}

	setReservationMode(reservationMode) {
		this.reservation.mode = reservationMode;
		return this;
	}

	setReservationPreempt(preempt) {
		this.reservation.preempt = preempt;
		return this;
	}

	setIOEnabled(ioEnabled) {
		this.ioEnabled = ioEnabled;
		return this;
	}

	setHiddenAttach() {
		this.is_hidden = true;
		this.reservation.mode = reservationModes.NONE;
		this.reservation.preempt = reservationModePreempts.WEAK_PREEMPT;
		this.reservation.version = 1;
		return this;
	}

	setAttachmentsVersion(version) {
		this.attachmentsVersion = version;
		return this;
	}
}


class AttachmentRequest extends BlockDevice {
	constructor(volumeID) {
		super(volumeID);
		this.vol_status = null;
	}
}

class AgentKeepAliveMessage {
	constructor(client, nvmfExportID) {
		this.registrant = {
			id: client.id,
			type: 'AGENT'
		};
		this.route = '/managementAgents/keepAlive/';
		this.opcode = consts.webSocketMessages.AGENT_KEEP_ALIVE;
		this.payload = {
			nvmfExportID: nvmfExportID || -1
		};
	}
}

exports.Client = Client;
exports.ClientKeepAliveMessage = ClientKeepAliveMessage;
exports.GetConfigurationRequest = GetConfigurationRequest;
exports.BlockDevice = BlockDevice;
exports.AttachmentRequest = AttachmentRequest;
exports.AgentKeepAliveMessage = AgentKeepAliveMessage;
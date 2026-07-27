/* global app */

const { KafkaMessageBuilder } = require('../kafkaMessageBuilder');
const { ClientKeepAlive } = require('./clientKeepAlive');
const { UpdateAttachmentStatus } = require('./updateAttachmentStatus');
const { GetTargetNICs } = require('./getTargetNICs');

exports.ClientMessageBuilder = class ClientMessageBuilder extends KafkaMessageBuilder {
	constructor(msg) {
		super(msg);

		// Default initial values
		this.msg.clientToken = -1;
		this.msg.messageSequence = 0;
		this.msg.originID = 'origin-1';
		this.msg.isUmClient = true;
	}

	setMessageSequence(value) {
		this.msg.messageSequence = value;
		return this;
	}

	incMessageSequence() {
		this.msg.incMessageSequence += 1;
		return this;
	}

	setToken(value) {
		this.msg.clientToken = value;
		return this;
	}

	setOriginID(value) {
		this.msg.originID = value;
		return this;
	}

	setIsUmClient(value) {
		this.msg.isUmClient = value;
		return this;
	}

	updateDataFromClient(client) {
		this.setToken(client.clientToken);
		this.setMessageSequence(client.messageSequence);
		this.setOriginID(client.originID);
		this.setIsUmClient(client.isUmClient);
		return this;
	}
};

exports.ClientKeepAliveBuilder = class ClientKeepAliveBuilder extends exports.ClientMessageBuilder {
	constructor(clientID) {
		let rawMsg = {
			clientID: clientID,
			keepaliveInterval: app.get('globalSettings').keepaliveIntervals.CLIENT,
			payload: {}
		};

		let msg = new ClientKeepAlive(rawMsg);
		super(msg);
	}

	static fromClient(client) {
		const builder = new ClientKeepAliveBuilder(client.id);
		builder.updateDataFromClient(client);
		builder.setClientVersionBranchCommit(client);
		builder.setConfigProfile(client.configProfile);
		builder.setClientStatus(client.client_status);
		builder.setAttachmentsUUIDHash(client.getAttachmentsUUIDHash());
		builder.setVolumeVersionsSum(client.getVolumeVersionsSum());
		builder.setAttachmentsVersion(client.attachmentsVersion);
		builder.setHasWIPOperations(false);

		client.messageSequence++;
		builder.msg.messageSequence = client.messageSequence;
		return builder;
	}

	setConfigProfile(configProfile) {
		this.msg.payload.configProfile = configProfile;
		return this;
	}

	setClientVersionBranchCommit(client) {
		this.msg.payload.featureCompatibilityVersion = client.featureCompatibilityVersion;
		this.msg.payload.version = client.version;
		this.msg.payload.branch = client.branch;
		this.msg.payload.commit = client.commit;
		return this;
	}

	setClientStatus(status) {
		this.msg.payload.client_status = status;
		return this;
	}

	setAttachmentsVersion(attachmentsVersion) {
		this.msg.payload.attachmentsVersion = attachmentsVersion;
		return this;
	}

	setHasWIPOperations(hasWIPOperations) {
		this.msg.payload.hasWIPOperations = hasWIPOperations;
		return this;
	}

	setAttachmentsUUIDHash(attachmentsUUIDHash) {
		this.msg.payload.attachmentsUUIDHash = attachmentsUUIDHash;
		return this;
	}

	setVolumeVersionsSum(volumeVersionsSum) {
		this.msg.payload.volumeVersionsSum = volumeVersionsSum;
		return this;
	}
};

exports.ClientUpdateAttachmentStatusBuilder = class ClientUpdateAttachmentStatusBuilder extends exports.ClientMessageBuilder {
	constructor(clientID) {
		let rawMsg = {
			clientID: clientID,
			keepaliveInterval: app.get('globalSettings').keepaliveIntervals.CLIENT,
			payload: {
				attachments: [],
				reportID: 0,
			}
		};

		let msg = new UpdateAttachmentStatus(rawMsg);
		super(msg);
	}

	static fromClient(client) {
		const builder = new ClientUpdateAttachmentStatusBuilder(client.id);
		builder.updateDataFromClient(client);
		builder.setClientStatus(client.client_status);
		builder.setAttachmentsVersion(client.attachmentsVersion);
		builder.setReportID(client.reportID);

		client.messageSequence++;
		builder.msg.messageSequence = client.messageSequence;
		return builder;
	}

	addAttachment(attachment) {
		this.msg.payload.attachments.push(attachment);
		return this;
	}

	setReportID(reportID) {
		this.msg.payload.reportID = reportID;
		return this;
	}

	setAttachmentsVersion(attachmentsVersion) {
		this.msg.payload.attachmentsVersion = attachmentsVersion;
		return this;
	}

	setClientStatus(status) {
		this.msg.payload.client_status = status;
		return this;
	}
};


exports.ClientGetTargetNICsBuilder = class ClientGetTargetNICsBuilder extends exports.ClientMessageBuilder {
	constructor(clientID) {
		let rawMsg = {
			clientID: clientID,
			clientToken: -1,
			payload: {
				targets: []
			}
		};

		let msg = new GetTargetNICs(rawMsg);
		super(msg);
	}

	static fromClient(client) {
		const builder = new ClientGetTargetNICsBuilder(client.id);
		builder.updateDataFromClient(client);

		client.messageSequence++;
		builder.msg.messageSequence = client.messageSequence;
		return builder;
	}

	addTarget(targetID, nicsVersion) {
		// payload format
		// "targets": [
		// 		{
		//			"node_id": "nvme1050.mtv.labs.mlnx",
		// 	  		"nicsVersion": 2
		// 		},
		// 		{
		//		"node_id": "nvme1051.mtv.labs.mlnx",
		// 	  		"nicsVersion": 1
		// 		}
		// ]

		let targetRequest = {
			node_id: targetID,
			nicsVersion: nicsVersion
		};

		this.msg.payload.targets.push(targetRequest);
		return this;
	}
};
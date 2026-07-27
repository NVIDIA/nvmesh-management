/* global app */

const { kafkaMessageTypes } = require('../../../consts');
const { MessageFromAgent } = require('../../../models/kafkaMessages/MessageFromAgent');
const { AgentMessageBuilder } = require('./agentMessageBuilder.js');
const versionForAPI = 1;

exports.AgentKeepAlive = class AgentKeepAlive extends MessageFromAgent {
	constructor(rawMsg) {
		super(kafkaMessageTypes.AgentToManagement.keepalive, versionForAPI, rawMsg);
	}
};

exports.AgentKeepAliveBuilder = class AgentKeepAliveBuilder extends AgentMessageBuilder {
	constructor(clientID) {
		let rawMsg = {
			clientID: clientID,
			keepaliveInterval: app.get('globalSettings').keepaliveIntervals.MANAGEMENT_AGENT,
			payload: {
				snapshotsStatus: [],
				configProfileInfo: {}
			}
		};

		let msg = new exports.AgentKeepAlive(rawMsg);
		super(msg);
	}

	setProfileInfo(profileInfo) {
		this.msg.payload.configProfileInfo = profileInfo;
		return this;
	}

	addSnapshotStatus(dataVolumeName, dataVolumeUUID) {
		this.msg.payload.snapshotsStatus.push({
			'dataVolumeUUID': dataVolumeUUID,
			'dataVolumeName': dataVolumeName
		});
		return this;
	}

	static fromClient(client) {
		const builder = new AgentKeepAliveBuilder(client.id);
		client.agentMessageSequence++;
		builder.updateDataFromClient(client);
		builder.setProfileInfo(client.configProfile);

		client.snapshotsStatus.forEach(s => {
			builder.addSnapshotStatus(s.dataVolumeName, s.dataVolumeUUID);
		});
		return builder;
	}
};
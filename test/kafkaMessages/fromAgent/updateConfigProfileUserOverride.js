const { kafkaMessageTypes } = require('../../../consts');
const { MessageFromAgent } = require('../../../models/kafkaMessages/MessageFromAgent');
const { ConfigProfileUpdatedBuilder } = require('./configProfileUpdated');
const versionForAPI = 1;

exports.UpdateConfigProfileUserOverride = class UpdateConfigProfileUserOverride extends MessageFromAgent {
	constructor(rawMsg) {
		super(kafkaMessageTypes.AgentToManagement.updateConfigProfileUserOverride, versionForAPI, rawMsg);
		this.payload = {
			configProfileInfo: {
				id: '',
				name: '',
				version: 0,
				userOverride: false
			},
		};
	}
};

exports.UpdateConfigProfileUserOverrideBuilder = class UpdateConfigProfileUserOverrideBuilder extends ConfigProfileUpdatedBuilder {
	constructor(clientID) {
		let rawMsg = {
			clientID: clientID,
			payload: {
				configProfileInfo: {
					id: 'cluster_default',
					name: 'Cluster Default',
					version: 5,
					userOverride: false
				}
			}
		};
		super(rawMsg);
		this.msg = new exports.UpdateConfigProfileUserOverride(this.msg);
	}

	setUserOverride(isOverride) {
		this.msg.payload.configProfileInfo.userOverride = isOverride;
		return this;
	}

	static fromClient(client) {
		const builder = new UpdateConfigProfileUserOverrideBuilder(client.id);
		builder.updateDataFromClient(client);
		builder.setProfileInfo(client.configProfile);
		client.agentMessageSequence++;
		builder.messageSequence = client.agentMessageSequence;
		return builder;
	}
};

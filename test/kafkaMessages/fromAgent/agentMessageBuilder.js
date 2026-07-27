

const { KafkaMessageBuilder } = require('../kafkaMessageBuilder.js');


exports.AgentMessageBuilder = class AgentMessageBuilder extends KafkaMessageBuilder {
	constructor(msg) {
		super(msg);

		// Default initial values
		this.msg.mgmtAgentToken = -1;
		this.msg.messageSequence = 0;
	}

	setMessageSequence(value) {
		this.msg.messageSequence = value;
		return this;
	}

	incMessageSequence() {
		this.msg.messageSequence += 1;
		return this;
	}

	setToken(value) {
		this.msg.mgmtAgentToken = value;
		return this;
	}

	setOriginID(value) {
		this.msg.originID = value;
		return this;
	}

	updateDataFromClient(client) {
		this.msg.clientID = client.id;
		this.msg.messageSequence = client.agentMessageSequence;
		this.msg.mgmtAgentToken = client.mgmtAgentToken;
		this.msg.originID = client.agentOriginID;
		this.msg.payload.version = client.version;
		this.msg.payload.featureCompatibilityVersion = client.featureCompatibilityVersion;
	}
};


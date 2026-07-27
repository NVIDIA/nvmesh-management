const { originTypes } = require('../../consts');
var { KafkaMessage } = require('./KafkaMessage');

exports.MessageFromUpgradeAgent = class MessageFromUpgradeAgent extends KafkaMessage {
	constructor(type, version, rawMsg) {
		super(type, version, rawMsg, originTypes.UPGRADE_AGENT);
	}

	deserialize(rawMsg) {
		this.upgradeAgentID = rawMsg.upgradeAgentID;
		this.hostname = rawMsg.hostname;
		this.upgradeAgentToken = rawMsg.upgradeAgentToken;
		this.messageSequence = rawMsg.messageSequence;
		this.keepaliveInterval = rawMsg.keepaliveInterval;

		return rawMsg.payload;
	}

	toJSON() {
		let json = super.toJSON();

		json['upgradeAgentID'] = this.upgradeAgentID;
		json['hostname'] = this.hostname;
		json['upgradeAgentToken'] = this.upgradeAgentToken;
		json['messageSequence'] = this.messageSequence;
		json['keepaliveInterval'] = this.keepaliveInterval;
		json['payload'] = this.payload;

		return json;
	}

	getNodeID() {
		return this.upgradeAgentID;
	}

	getToken() {
		return this.upgradeAgentToken;
	}
};
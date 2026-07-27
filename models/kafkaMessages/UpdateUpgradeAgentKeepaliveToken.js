const { kafkaMessageTypes } = require('../../consts');
const { KafkaMessage } = require('./KafkaMessage');

exports.UpdateUpgradeAgentKeepaliveToken = class UpdateTomaKeepaliveToken extends KafkaMessage {
	constructor(upgradeAgentID, token, keepaliveInterval, messageSequence, additionalData = [],
		type = kafkaMessageTypes.ManagementToUpgradeAgent.updateUpgradeAgentKeepaliveToken, version = 1) {
		super(type, version);

		this.upgradeAgentID = upgradeAgentID;
		this.upgradeAgentToken = token;
		this.keepaliveInterval = keepaliveInterval;
		this.messageSequence = messageSequence;
		this.additionalData = additionalData;
	}

	toJSON() {
		const json = super.toJSON();

		json['payload'] = {
			upgradeAgentID: this.upgradeAgentID,
			upgradeAgentToken: this.upgradeAgentToken,
			keepaliveInterval: this.keepaliveInterval,
			messageSequence: this.messageSequence,
			additionalData: this.additionalData
		};

		return json;
	}
};
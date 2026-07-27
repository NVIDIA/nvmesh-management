const { kafkaMessageTypes } = require('../../consts');
var { KafkaMessage } = require('./KafkaMessage');

exports.UpdateLeaderKeepaliveToken = class UpdateLeaderKeepaliveToken extends KafkaMessage {
	constructor(token, keepaliveInterval, type = kafkaMessageTypes.ManagementToTOMA.updateLeaderKeepaliveToken, version = 1) {
		super(type, version);

		this.token = token;
		this.keepaliveInterval = keepaliveInterval;
	}

	toJSON() {
		var json = super.toJSON();

		json['payload'] = {
			token: this.token,
			keepaliveInterval: this.keepaliveInterval
		};

		return json;
	}
};
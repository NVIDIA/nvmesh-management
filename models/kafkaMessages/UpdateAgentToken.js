const { kafkaMessageTypes } = require('../../consts');
var { KafkaMessage } = require('./KafkaMessage');

exports.UpdateAgentToken = class UpdateAgentToken extends KafkaMessage {
	constructor(clientID, token, messageSequence, originID, keepaliveInterval, type = kafkaMessageTypes.ManagementToAgent.updateAgentToken, version = 1) {
		super(type, version, null, null, originID);

		this.payload = { 
			clientID: clientID,
			token: token,
			messageSequence: messageSequence,
			keepaliveInterval: keepaliveInterval 
		};
	}
};
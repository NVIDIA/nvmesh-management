var { KafkaMessage } = require('./KafkaMessage');
var { webSocketMessages, kafkaMessageTypes } = require('../../consts');

exports.UpdateClientToken = class UpdateClientToken extends KafkaMessage {
	constructor(clientID, clientUUID, clientToken, attachmentsVersion, messageSequence, reportID, originID, keepaliveInterval,
		type = kafkaMessageTypes.ManagementToClient.updateClientToken, version = 1) {
		super(type, version, null, null, originID, webSocketMessages.UPDATE_CLIENT_KEEPALIVE_TOKEN);

		if (!reportID && reportID !== 0)
			throw new Error(`Missing reportID in UpdateClientToken. got reportID="${reportID}"`);

		if (!clientUUID)
			throw new Error(`Missing clientUUID in UpdateClientToken. client ${clientID} clientToken: ${clientToken}`);

		this.payload = {
			clientToken: clientToken,
			attachmentsVersion: attachmentsVersion,
			clientUUID: clientUUID,
			messageSequence: messageSequence,
			reportID: reportID,
			keepaliveInterval: keepaliveInterval
		};
	}
};
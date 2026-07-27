const { kafkaMessageTypes } = require('../../../consts');
const { MessageFromClient } = require('../../../models/kafkaMessages/MessageFromClient');
const versionForAPI = 1;

exports.ClientKeepAlive = class ClientKeepAlive extends MessageFromClient {
	constructor(rawMsg) {
		super(kafkaMessageTypes.ClientToManagement.keepalive, versionForAPI, rawMsg);
	}
};
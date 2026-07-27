const { kafkaMessageTypes } = require('../../../consts');
const { MessageFromClient } = require('../../../models/kafkaMessages/MessageFromClient');
const versionForAPI = 1;

exports.GetTargetNICs = class GetTargetNICs extends MessageFromClient {
	constructor(rawMsg) {
		super(kafkaMessageTypes.ClientToManagement.getTargetNICs, versionForAPI, rawMsg);
	}
};
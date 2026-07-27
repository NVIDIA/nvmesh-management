const { kafkaMessageTypes } = require('../../../consts');
const { MessageFromTOMA } = require('../../../models/kafkaMessages/MessageFromTOMA');
const versionForAPI = 1;

exports.TomaKeepAlive = class TomaKeepAlive extends MessageFromTOMA {
	constructor(rawMsg) {
		super(kafkaMessageTypes.TOMAToManagament.keepalive, versionForAPI, rawMsg);
	}
};
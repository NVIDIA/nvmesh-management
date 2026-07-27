const { kafkaMessageTypes } = require('../../../consts');
const { MessageFromClient } = require('../../../models/kafkaMessages/MessageFromClient');
const versionForAPI = 1;

exports.UpdateAttachmentStatus = class UpdateAttachmentStatus extends MessageFromClient {
	constructor(rawMsg) {
		super(kafkaMessageTypes.ClientToManagement.updateAttachmentStatus, versionForAPI, rawMsg);
	}
};
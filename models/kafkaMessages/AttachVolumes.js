var { KafkaMessage } = require('./KafkaMessage');
var { webSocketMessages } = require('../../consts');
const consts = require('../../consts');

exports.AttachVolumes = class AttachVolumes extends KafkaMessage {
	constructor(confObj, originID, type = consts.kafkaMessageTypes.ManagementToClient.attachVolumes, version = 1) {
		super(type, version, null, null, originID, webSocketMessages.ATTACH_VOLUMES);
		if (!originID)
			throw new Error('AttachVolumes is missing originID');
		this.payload = confObj;
	}
};
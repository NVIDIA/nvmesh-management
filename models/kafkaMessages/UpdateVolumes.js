var { KafkaMessage } = require('./KafkaMessage');
var { webSocketMessages, updateTypes } = require('../../consts');
const consts = require('../../consts');

exports.UpdateVolumes = class UpdateVolumes extends KafkaMessage {
	constructor(confObj, originID, type = consts.kafkaMessageTypes.ManagementToClient.updateVolumes, version = 1) {
		super(type, version, null, null, originID, webSocketMessages.UPDATE_VOLUMES);
		confObj.updateType = updateTypes.FULL;
		this.payload = confObj;
	}
};
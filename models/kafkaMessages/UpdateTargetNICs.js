const { webSocketMessages, kafkaMessageTypes } = require('../../consts');
const { KafkaMessage } = require('./KafkaMessage');

exports.UpdateTargetNICs = class UpdateTargetNICs extends KafkaMessage {
	constructor(targets, originID, type = kafkaMessageTypes.ManagementToClient.updateTargetNICs, version = 1) {
		super(type, version, null, null, originID, webSocketMessages.UPDATE_TARGET_NICS);

		this.payload = { 
			targets: targets
		};
	}
};

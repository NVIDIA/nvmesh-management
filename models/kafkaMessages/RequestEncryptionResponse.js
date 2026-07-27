const { kafkaMessageTypes } = require('../../consts');
const { EncryptionCommandMessage } = require('./EncryptionCommandMessage');

exports.RequestEncryptionResponse = class RequestEncryptionResponse extends EncryptionCommandMessage {
	constructor(
		executingTOMA,
		volumeName,
		volumeUUID,
		commandIndex,
		type = kafkaMessageTypes.ManagementToTOMA.requestEncryptionResponse,
		version = 1
	) {
		super(executingTOMA, volumeName, volumeUUID, commandIndex, type, version);
	}
};
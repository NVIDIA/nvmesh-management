const { kafkaMessageTypes } = require('../../consts');
const { EncryptionCommandMessage } = require('./EncryptionCommandMessage');

exports.InitEncryption = class InitEncryption extends EncryptionCommandMessage {
	constructor(
		executingTOMA,
		bootTime,
		volumeName,
		volumeUUID,
		commandIndex,
		passphrase,
		slot = 1,
		keySize = 512,
		type = kafkaMessageTypes.ManagementToTOMA.initEncryption,
		version = 1
	) {
		super(executingTOMA, bootTime, volumeName, volumeUUID, commandIndex, type, version);

		this.passphrase = passphrase;
		this.slot = slot;
		this.keySize = keySize;
	}

	toJSON() {
		let json = super.toJSON();

		json.payload.passphrase = this.passphrase;
		json.payload.slot = this.slot;
		json.payload.keySize = this.keySize;

		return json;
	}
};
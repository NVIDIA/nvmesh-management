const { kafkaMessageTypes } = require('../../consts');
const { VolumeMessage } = require('./VolumeMessage');

exports.DeleteVolume = class DeleteVolume extends VolumeMessage {
	constructor(volumeID, volumeUUID, volumeVersion, type = kafkaMessageTypes.ManagementToTOMA.deleteVolume, version = 1) {
		super(type, version);

		this.volumeID = volumeID;
		this.volumeUUID = volumeUUID;
		this.volumeVersion = volumeVersion;
	}

	preparePayload(payload) {
		return payload;
	}

	toJSON() {
		var json = super.toJSON();

		json['payload'] = {
			name: this.volumeID,
			uuid: this.volumeUUID,
			version: this.volumeVersion
		};

		return json;
	}
};
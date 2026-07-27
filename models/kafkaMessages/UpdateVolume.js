const { kafkaMessageTypes } = require('../../consts');
const { VolumeMessage } = require('./VolumeMessage');


exports.UpdateVolume = class UpdateVolume extends VolumeMessage {
	constructor(confObj, type = kafkaMessageTypes.ManagementToTOMA.updateVolume, version = 1) {
		super(type, version, confObj);
	}
};
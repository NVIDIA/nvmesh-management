var { KafkaMessage } = require('./KafkaMessage');
var { webSocketMessages, kafkaMessageTypes } = require('../../consts');

exports.VolumeRemoved = class VolumeRemoved extends KafkaMessage {
	constructor(clientID, volumeID, volumeUUID, health, isReserved, originID, type = kafkaMessageTypes.ManagementToClient.volumeRemoved, version = 1) {
		super(type, version, null, null, originID, webSocketMessages.VOLUME_REMOVED_EVENT);

		this.clientID = clientID;
		this.volumeID = volumeID;
		this.volumeUUID = volumeUUID;
		this.health = health;
		this.isReserved = isReserved;
	}

	toJSON() {
		var json = super.toJSON();

		json['payload'] = {
			clientID: this.clientID,
			volumeID: this.volumeID,
			uuid: this.volumeUUID,
			health: this.health,
			isReserved: this.isReserved
		};

		return json;
	}
};

const { kafkaMessageTypes } = require('../../consts');
const { KafkaMessage } = require('./KafkaMessage');

exports.DeleteTarget = class DeleteTarget extends KafkaMessage {
	constructor(nodeID, nodeUUID, targetsInZone, targetUpdatesSequence, type = kafkaMessageTypes.ManagementToTOMA.deleteTarget, version = 1) {
		super(type, version);

		this.nodeID = nodeID;
		this.nodeUUID = nodeUUID;
		this.targetsInZone = targetsInZone;
		this.targetUpdatesSequence = targetUpdatesSequence;
	}

	toJSON() {
		let json = super.toJSON();

		json['payload'] = {
			nodeID: this.nodeID,
			uuid: this.nodeUUID,
			targetsInZone: this.targetsInZone,
			targetUpdatesSequence: this.targetUpdatesSequence
		};

		return json;
	}
};
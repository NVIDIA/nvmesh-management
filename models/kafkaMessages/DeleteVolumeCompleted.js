/*
 * SPDX-FileCopyrightText: Copyright (c) 2026 NVIDIA CORPORATION & AFFILIATES. All rights reserved.
 * SPDX-License-Identifier: Apache-2.0
 */

const { kafkaMessageTypes } = require('../../consts');
var { KafkaMessage } = require('./KafkaMessage');

exports.DeleteVolumeCompleted = class DeleteVolumeCompleted extends KafkaMessage {
	constructor(volumeID, volumeUUID, type = kafkaMessageTypes.ManagementToTOMA.deleteVolumeCompleted, version = 1) {
		super(type, version);

		this.volumeID = volumeID;
		this.volumeUUID = volumeUUID;
	}

	toJSON() {
		var json = super.toJSON();

		json['payload'] = {
			name: this.volumeID,
			uuid: this.volumeUUID
		};

		return json;
	}
};

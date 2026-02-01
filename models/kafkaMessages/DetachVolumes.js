/*
 * SPDX-FileCopyrightText: Copyright (c) 2026 NVIDIA CORPORATION & AFFILIATES. All rights reserved.
 * SPDX-License-Identifier: Apache-2.0
 */

var { KafkaMessage } = require('./KafkaMessage');
var { webSocketMessages, kafkaMessageTypes } = require('../../consts');

exports.DetachVolumes = class DetachVolumes extends KafkaMessage {
	constructor(clientID, attachmentsVersion, volumes, originID, type = kafkaMessageTypes.ManagementToClient.detachVolumes, version = 1) {
		super(type, version, null, null, originID, webSocketMessages.DETACH_VOLUMES);

		this.clientID = clientID;
		this.attachmentsVersion = attachmentsVersion;
		this.volumes = volumes;
	}

	toJSON() {
		var json = super.toJSON();

		json['payload'] = {
			clientID: this.clientID,
			attachmentsVersion: this.attachmentsVersion,
			volumes: this.volumes
		};

		return json;
	}
};

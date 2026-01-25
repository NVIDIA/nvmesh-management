/*
 * SPDX-FileCopyrightText: Copyright (c) 2026 NVIDIA CORPORATION & AFFILIATES. All rights reserved.
 * SPDX-License-Identifier: Apache-2.0
 */

const { kafkaMessageTypes } = require('../../consts');
var { KafkaMessage } = require('./KafkaMessage');

exports.UpdateConfigProfile = class UpdateConfigProfile extends KafkaMessage {
	constructor(clientID, payload, originID, type = kafkaMessageTypes.ManagementToAgent.updateConfigProfile, version = 1) {
		super(type, version, null, null, originID);
		this.clientID = clientID;
		this.payload = payload;
		if (!this.originID) {
			throw new Error('UpdateConfigProfile: Missing originID');
		}
	}

	toJSON() {
		var json = super.toJSON();
		return json;
	}
};

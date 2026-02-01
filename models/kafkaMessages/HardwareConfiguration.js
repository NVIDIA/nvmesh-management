/*
 * SPDX-FileCopyrightText: Copyright (c) 2026 NVIDIA CORPORATION & AFFILIATES. All rights reserved.
 * SPDX-License-Identifier: Apache-2.0
 */

const { kafkaMessageTypes } = require('../../consts');
var { KafkaMessage } = require('./KafkaMessage');

exports.HardwareConfiguration = class HardwareConfiguration extends KafkaMessage {
	constructor(confObj, type = kafkaMessageTypes.ManagementToTOMA.hardwareConfiguration, version = 1) {
		super(type, version, confObj);
	}

	deserialize(confObj) {
		return confObj;
	}

	toJSON() {
		var json = super.toJSON();

		return json;
	}
};

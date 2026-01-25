/*
 * SPDX-FileCopyrightText: Copyright (c) 2026 NVIDIA CORPORATION & AFFILIATES. All rights reserved.
 * SPDX-License-Identifier: Apache-2.0
 */

const { kafkaMessageTypes } = require('../../consts');
var { KafkaMessage } = require('./KafkaMessage');

exports.FormatDrive = class FormatDrive extends KafkaMessage {
	constructor(driveObj, type = kafkaMessageTypes.ManagementToTOMA.formatDrive, version = 1) {
		super(type, version, driveObj);
	}

	deserialize(driveObj) {
		return driveObj;
	}
};

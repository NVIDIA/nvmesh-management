/*
 * SPDX-FileCopyrightText: Copyright (c) 2026 NVIDIA CORPORATION & AFFILIATES. All rights reserved.
 * SPDX-License-Identifier: Apache-2.0
 */

const { kafkaMessageTypes } = require('../../consts');
var { KafkaMessage } = require('./KafkaMessage');

exports.ResendReport = class ResendReport extends KafkaMessage {
	constructor(drives, tomaToken, type = kafkaMessageTypes.ManagementToTOMA.resendReport, version = 1) {
		super(type, version);

		this.drives = drives;
		this.tomaToken = tomaToken;
	}

	toJSON() {
		var json = super.toJSON();

		json.payload = {
			drives: this.drives,
			tomaToken: this.tomaToken
		};

		return json;
	}
};

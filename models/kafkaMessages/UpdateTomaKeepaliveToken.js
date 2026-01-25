/*
 * SPDX-FileCopyrightText: Copyright (c) 2026 NVIDIA CORPORATION & AFFILIATES. All rights reserved.
 * SPDX-License-Identifier: Apache-2.0
 */

const { kafkaMessageTypes } = require('../../consts');
var { KafkaMessage } = require('./KafkaMessage');

exports.UpdateTomaKeepaliveToken = class UpdateTomaKeepaliveToken extends KafkaMessage {
	constructor(nodeID, token, keepaliveInterval, zone = '-1',
		type = kafkaMessageTypes.ManagementToTOMA.updateTomaKeepaliveToken, version = 1) {
		super(type, version);

		this.nodeID = nodeID;
		this.token = token;
		this.zone = zone;
		this.keepaliveInterval = keepaliveInterval;
	}

	toJSON() {
		var json = super.toJSON();

		json['payload'] = {
			nodeID: this.nodeID,
			token: this.token,
			zone: this.zone,
			keepaliveInterval: this.keepaliveInterval
		};

		return json;
	}
};

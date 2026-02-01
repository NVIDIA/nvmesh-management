/*
 * SPDX-FileCopyrightText: Copyright (c) 2026 NVIDIA CORPORATION & AFFILIATES. All rights reserved.
 * SPDX-License-Identifier: Apache-2.0
 */

const { originTypes } = require('../../consts');
var { KafkaMessage } = require('./KafkaMessage');

exports.MessageFromTOMA = class MessageFromTOMA extends KafkaMessage {
	constructor(type, version, rawMsg) {
		super(type, version, rawMsg, originTypes.TOMA);
	}

	deserialize(rawMsg) {
		this.hostname = rawMsg.hostname;
		this.tomaToken = rawMsg.tomaToken;
		this.leaderToken = rawMsg.leaderToken;
		this.messageSequence = rawMsg.messageSequence;
		this.keepaliveInterval = rawMsg.keepaliveInterval;

		return rawMsg.payload;
	}

	toJSON() {
		let json = super.toJSON();

		json['hostname'] = this.hostname;
		json['tomaToken'] = this.tomaToken;
		json['leaderToken'] = this.leaderToken;
		json['messageSequence'] = this.messageSequence;
		json['keepaliveInterval'] = this.keepaliveInterval;
		json['payload'] = this.payload;

		return json;
	}

	isLeader() {
		return Boolean(this.leaderToken && this.leaderToken >= 0);
	}

	getNodeID() {
		return this.hostname;
	}

	getToken() {
		var token = this.isLeader() ? this.leaderToken : (this.tomaToken && this.tomaToken >= 0 ? this.tomaToken : null);
		return token;
	}
};

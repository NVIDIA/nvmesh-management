/*
 * SPDX-FileCopyrightText: Copyright (c) 2026 NVIDIA CORPORATION & AFFILIATES. All rights reserved.
 * SPDX-License-Identifier: Apache-2.0
 */

const { originTypes } = require('../../consts');
var { KafkaMessage } = require('./KafkaMessage');

exports.MessageFromAgent = class MessageFromAgent extends KafkaMessage {
	constructor(type, version, rawMsg) {
		super(type, version, rawMsg, originTypes.MANAGEMENT_AGENT);
	}

	deserialize(rawMsg) {
		this.clientID = rawMsg.clientID;
		this.mgmtAgentToken = rawMsg.mgmtAgentToken;
		this.messageSequence = rawMsg.messageSequence;
		this.keepaliveInterval = rawMsg.keepaliveInterval;
		return rawMsg.payload;
	}

	toJSON() {
		let json = super.toJSON();

		json['clientID'] = this.clientID;
		json['mgmtAgentToken'] = this.mgmtAgentToken;
		json['messageSequence'] = this.messageSequence;
		json['keepaliveInterval'] = this.keepaliveInterval;
		json['payload'] = this.payload;

		return json;
	}

	getNodeID() {
		return this.clientID;
	}

	getToken() {
		return this.mgmtAgentToken;
	}
};

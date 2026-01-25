/*
 * SPDX-FileCopyrightText: Copyright (c) 2026 NVIDIA CORPORATION & AFFILIATES. All rights reserved.
 * SPDX-License-Identifier: Apache-2.0
 */

exports.KafkaMessage = class KafkaMessage {
	constructor(type, version, rawMsg, originType, originID, opcode) {
		this.type = type;
		this.version = version;
		this.originType = originType;
		this.originID = rawMsg && !Array.isArray(rawMsg) && rawMsg.originID ? rawMsg.originID : originID;
		this.opcode = opcode;

		if (rawMsg)
			this.payload = this.preparePayload(this.deserialize(rawMsg));
	}

	deserialize(rawMsg) {
		return JSON.parse(rawMsg);
	}

	preparePayload(payload) {
		return payload;
	}

	toJSON() {
		return {
			messageType: this.type,
			messageTypeVersion: this.version,
			originType: this.originType,
			originID: this.originID,
			opcode: this.opcode,
			payload: this.payload
		};
	}
};

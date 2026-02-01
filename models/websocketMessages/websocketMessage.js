/*
 * SPDX-FileCopyrightText: Copyright (c) 2026 NVIDIA CORPORATION & AFFILIATES. All rights reserved.
 * SPDX-License-Identifier: Apache-2.0
 */

const { WS_PROTOCOL_VERSION } = require('../../consts');

exports.WebsocketMessage = class WebsocketMessage {
	constructor(messageType, messageTypeVersion, registrant, accessToken, payload, protocolVersion = WS_PROTOCOL_VERSION) {
		this.protocolVersion = protocolVersion;
		this.messageType = messageType;
		this.messageTypeVersion = messageTypeVersion;
		this.registrant = registrant;
		this.accessToken = accessToken;
		this.payload = payload;
	}

	/**
	 * Casts a WebsocketMessage to a LoginMessage
	 * @param {object} obj - an object.
	 * @returns {WebsocketMessage} A WebsocketMessage.
	 */
	static fromObject(obj) {
		return Object.assign(new WebsocketMessage(), obj);
	}

	toString() {
		return JSON.stringify(this);
	}

	serialize() {
		return JSON.stringify(this);
	}
};

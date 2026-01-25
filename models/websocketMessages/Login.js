/*
 * SPDX-FileCopyrightText: Copyright (c) 2026 NVIDIA CORPORATION & AFFILIATES. All rights reserved.
 * SPDX-License-Identifier: Apache-2.0
 */

const { websocketMessageTypes } = require('../../consts');
const { WebsocketMessage } = require('./websocketMessage');

exports.LoginMessage = class LoginMessage extends WebsocketMessage {
	constructor(username, password, registrant, messageType = websocketMessageTypes.login, messageTypeVersion = 1) {
		super(messageType, messageTypeVersion, registrant);

		this.payload = {
			username: username,
			password: password
		};
	}

	/**
	 * Casts a WebsocketMessage to a LoginMessage
	 * @param {WebsocketMessage} m - The WebsocketMessage.
	 * @returns {LoginMessage} A LoginMessage.
	 */
	static fromObject(m) {
		return Object.assign(new LoginMessage(), m);
	}
};

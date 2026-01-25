/*
 * SPDX-FileCopyrightText: Copyright (c) 2026 NVIDIA CORPORATION & AFFILIATES. All rights reserved.
 * SPDX-License-Identifier: Apache-2.0
 */

const { websocketMessageTypes } = require('../../consts');
const { WebsocketMessage } = require('./websocketMessage');

exports.RegisterToEventsMessage = class RegisterToEventsMessage extends WebsocketMessage {
	constructor(events, registrant, acessToken, messageType = websocketMessageTypes.registerToEvents, messageTypeVersion = 1) {
		super(messageType, messageTypeVersion, registrant, acessToken);

		this.payload = {
			events: events
		};
	}

	/**
	 * Casts a WebsocketMessage to a LoginMessage
	 * @param {WebsocketMessage} m - The WebsocketMessage.
	 * @returns {RegisterToEventsMessage} A RegisterToEventsMessage.
	 */
	static fromObject(m) {
		return Object.assign(new RegisterToEventsMessage(), m);
	}
};

/*
 * SPDX-FileCopyrightText: Copyright (c) 2026 NVIDIA CORPORATION & AFFILIATES. All rights reserved.
 * SPDX-License-Identifier: Apache-2.0
 */

const { websocketMessageTypes } = require('../../consts');
const { WebsocketMessage } = require('./websocketMessage');

exports.ErrorResponse = class ErrorResponse extends WebsocketMessage {
	constructor(code, errorMessage, registrant, type = websocketMessageTypes.errorResponse, version = 1) {
		super(type, version, registrant);

		this.payload = {
			error: {
				code: code,
				message: errorMessage
			}
		};
	}

	/**
	 * Casts a WebsocketMessage to a LoginMessage
	 * @param {WebsocketMessage} m - The WebsocketMessage.
	 * @returns {ErrorResponse} A LoginMessage.
	 */
	static fromObject(m) {
		return Object.assign(new ErrorResponse(), m);
	}
};

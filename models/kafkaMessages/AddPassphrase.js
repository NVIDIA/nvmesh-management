/*
 * SPDX-FileCopyrightText: Copyright (c) 2026 NVIDIA CORPORATION & AFFILIATES. All rights reserved.
 * SPDX-License-Identifier: Apache-2.0
 */

const { kafkaMessageTypes } = require('../../consts');
const { EncryptionCommandMessage } = require('./EncryptionCommandMessage');

exports.AddPassphrase = class AddPassphrase extends EncryptionCommandMessage {
	constructor(
		executingTOMA,
		bootTime,
		volumeName,
		volumeUUID,
		commandIndex,
		currentPassphrase,
		newPassphrase,
		slot = 1,
		type = kafkaMessageTypes.ManagementToTOMA.addPassphrase,
		version = 1
	) {
		super(executingTOMA, bootTime, volumeName, volumeUUID, commandIndex, type, version);

		this.currentPassphrase = currentPassphrase;
		this.newPassphrase = newPassphrase;
		this.slot = slot;
	}

	toJSON() {
		let json = super.toJSON();

		json.payload.currentPassphrase = this.currentPassphrase;
		json.payload.newPassphrase = this.newPassphrase;
		json.payload.slot = this.slot;

		return json;
	}
};

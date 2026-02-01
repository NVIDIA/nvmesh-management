/*
 * SPDX-FileCopyrightText: Copyright (c) 2026 NVIDIA CORPORATION & AFFILIATES. All rights reserved.
 * SPDX-License-Identifier: Apache-2.0
 */

const { kafkaMessageTypes } = require('../../consts');
const { EncryptionCommandMessage } = require('./EncryptionCommandMessage');

exports.DeletePassphrase = class DeletePassphrase extends EncryptionCommandMessage {
	constructor(
		executingTOMA,
		bootTime,
		volumeName,
		volumeUUID,
		commandIndex,
		currentPassphrase,
		type = kafkaMessageTypes.ManagementToTOMA.deletePassphrase,
		version = 1
	) {
		super(executingTOMA, bootTime, volumeName, volumeUUID, commandIndex, type, version);

		this.currentPassphrase = currentPassphrase;
	}

	toJSON() {
		let json = super.toJSON();

		json.payload.currentPassphrase = this.currentPassphrase;

		return json;
	}
};

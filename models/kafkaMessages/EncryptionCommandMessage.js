/*
 * SPDX-FileCopyrightText: Copyright (c) 2026 NVIDIA CORPORATION & AFFILIATES. All rights reserved.
 * SPDX-License-Identifier: Apache-2.0
 */

const { KafkaMessage } = require('./KafkaMessage');

exports.EncryptionCommandMessage = class EncryptionCommandMessage extends KafkaMessage {
	constructor(executingTOMA, bootTime, volumeName, volumeUUID, commandIndex, type, version) {
		super(type, version);

		this.executingTOMA = executingTOMA;
		this.bootTime = bootTime;
		this.volumeName = volumeName;
		this.volumeUUID = volumeUUID;
		this.commandIndex = commandIndex;
	}

	toJSON() {
		let json = super.toJSON();

		json['payload'] = {
			bootTime: this.bootTime,
			volumeName: this.volumeName,
			volumeUUID: this.volumeUUID,
			encryptionCommandIndex: this.commandIndex
		};

		return json;
	}
};

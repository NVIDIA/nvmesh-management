/*
 * SPDX-FileCopyrightText: Copyright (c) 2026 NVIDIA CORPORATION & AFFILIATES. All rights reserved.
 * SPDX-License-Identifier: Apache-2.0
 */

const consts = require('../../consts');
const { ClientConfigurationMessage } = require('./ClientConfigurationMessage.js');

exports.AttachVolumes = class AttachVolumes extends ClientConfigurationMessage {
	constructor(confObj, originID, type = consts.kafkaMessageTypes.ManagementToClient.attachVolumes, version = 1) {
		super(type, version, null, null, originID, consts.webSocketMessages.ATTACH_VOLUMES);
		if (!originID)
			throw new Error('AttachVolumes is missing originID');
		this.payload = this.preparePayload(confObj);
	}
};

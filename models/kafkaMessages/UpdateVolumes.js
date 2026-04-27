/*
 * SPDX-FileCopyrightText: Copyright (c) 2026 NVIDIA CORPORATION & AFFILIATES. All rights reserved.
 * SPDX-License-Identifier: Apache-2.0
 */

const consts = require('../../consts');
const { ClientConfigurationMessage } = require('./ClientConfigurationMessage.js');

exports.UpdateVolumes = class UpdateVolumes extends ClientConfigurationMessage {
	constructor(confObj, originID, type = consts.kafkaMessageTypes.ManagementToClient.updateVolumes, version = 1) {
		super(type, version, null, null, originID, consts.webSocketMessages.UPDATE_VOLUMES);
		this.payload = this.preparePayload({ ...confObj, updateType: consts.updateTypes.FULL });
	}
};

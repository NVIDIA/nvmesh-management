/*
 * SPDX-FileCopyrightText: Copyright (c) 2026 NVIDIA CORPORATION & AFFILIATES. All rights reserved.
 * SPDX-License-Identifier: Apache-2.0
 */

const { kafkaMessageTypes } = require('../../../consts');
const { MessageFromClient } = require('../../../models/kafkaMessages/MessageFromClient');
const versionForAPI = 1;

exports.UpdateAttachmentStatus = class UpdateAttachmentStatus extends MessageFromClient {
	constructor(rawMsg) {
		super(kafkaMessageTypes.ClientToManagement.updateAttachmentStatus, versionForAPI, rawMsg);
	}
};
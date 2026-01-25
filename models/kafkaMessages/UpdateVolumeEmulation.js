/*
 * SPDX-FileCopyrightText: Copyright (c) 2026 NVIDIA CORPORATION & AFFILIATES. All rights reserved.
 * SPDX-License-Identifier: Apache-2.0
 */

var { KafkaMessage } = require('./KafkaMessage');
var { webSocketMessages } = require('../../consts');
const consts = require('../../consts');

exports.UpdateVolumeEmulation = class UpdateVolumeEmulation extends KafkaMessage {
	constructor(
		emulation,
		volumeUUID,
		volumeName,
		attachmentChangesVersion, // The version field on the attachment, indicates changes to an attached attachment state (e.g emulation mode change)
		attachmentsVersionRef, // The attachmentsVersion on the attachment, was set when attached
		originID, type = consts.kafkaMessageTypes.ManagementToClient.updateVolumeEmulation, version = 1
	) {
		super(type, version, null, null, originID, webSocketMessages.UPDATE_VOLUME_EMULATION);

		if (!originID)
			throw new Error(`${consts.kafkaMessageTypes.ManagementToClient.updateVolumeEmulation} is missing originID`);

		this.payload = {
			attachment: {
				emulation,
				attachmentsVersionRef,
				version: attachmentChangesVersion
			},
			volumeUUID,
			volumeName
		};
	}
};

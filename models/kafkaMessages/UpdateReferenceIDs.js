/*
 * SPDX-FileCopyrightText: Copyright (c) 2026 NVIDIA CORPORATION & AFFILIATES. All rights reserved.
 * SPDX-License-Identifier: Apache-2.0
 */

var { KafkaMessage } = require('./KafkaMessage');
var { webSocketMessages } = require('../../consts');
const consts = require('../../consts');

exports.UpdateReferenceIDs = class UpdateReferenceIDs extends KafkaMessage {
	constructor(
		referenceIDs,
		volumeUUID,
		volumeName,
		attachmentsVersion,
		attachmentChangesVersion, // The version field on the attachment, indicates changes to an attached attachment state (e.g emulation mode change)
		originID,
		type = consts.kafkaMessageTypes.ManagementToClient.updateReferenceIDs,
		version = 1
	) {
		super(type, version, null, null, originID, webSocketMessages.UPDATE_VOLUME_REFERENCE);

		if (!originID)
			throw new Error(`${consts.kafkaMessageTypes.ManagementToClient.updateReferenceIDs} is missing originID`);

		this.payload = {
			attachment: {
				referenceIDs,
				attachmentsVersionRef: attachmentsVersion,
				// attachmentsVersionRef = The attachmentsVersion on the attachment, was set when attached.
				// as attachmentsVersion is incremented during detach they are equal in this scenario
				version: attachmentChangesVersion
			},
			volumeUUID,
			volumeName,
			attachmentsVersion
		};
	}
};

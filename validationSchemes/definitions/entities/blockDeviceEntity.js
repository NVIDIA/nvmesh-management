/*
 * SPDX-FileCopyrightText: Copyright (c) 2026 NVIDIA CORPORATION & AFFILIATES. All rights reserved.
 * SPDX-License-Identifier: Apache-2.0
 */

var consts = require('../../../consts.js');
var scheme = {
	$id: consts.MANAGEMENT_DEFINITIONS_ENTITIES + '/blockDeviceEntity.js',
	type: 'object',
	properties: {
		uuid: { type: 'string' },
		name: { type: 'string' },
		vol_status: { enum: [
			consts.volumeAttachmentStatus.ATTACHED,
			consts.volumeAttachmentStatus.ATTACH_FAILED,
			consts.volumeAttachmentStatus.BUSY,
			consts.volumeAttachmentStatus.DETACHED,
			consts.volumeAttachmentStatus.DETACH_FAILED
		] },
		is_hidden: { type: 'integer' },
		ioEnabled: { enum: [0, 1] }
	},
	required: ['uuid', 'name', 'vol_status', 'is_hidden'],
	if: { properties: { vol_status: { const: consts.volumeAttachmentStatus.ATTACHED } } },
	then: { required: ['ioEnabled'] }
};

module.exports = scheme;
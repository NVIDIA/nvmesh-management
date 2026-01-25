/*
 * SPDX-FileCopyrightText: Copyright (c) 2026 NVIDIA CORPORATION & AFFILIATES. All rights reserved.
 * SPDX-License-Identifier: Apache-2.0
 */

var consts = require('../../consts.js');

var scheme = {
	$id: consts.MANAGEMENT_DEFINITIONS + '/extendedVolume.js',
	type: 'object',
	properties: {
		_id: { $ref: consts.MANAGEMENT_DEFINITIONS + '/volumeName.js' },
		uuid: { $ref: consts.MANAGEMENT_DEFINITIONS + '/uuid.js' },
		capacity: { $ref: consts.MANAGEMENT_DEFINITIONS + '/capacity.js' },
		allowAllocationOnOfflineDrives: { type: 'boolean', default: false }
	},
	required: ['capacity', '_id', 'uuid']
};

module.exports = scheme;
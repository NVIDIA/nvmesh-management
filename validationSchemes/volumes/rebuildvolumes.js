/*
 * SPDX-FileCopyrightText: Copyright (c) 2026 NVIDIA CORPORATION & AFFILIATES. All rights reserved.
 * SPDX-License-Identifier: Apache-2.0
 */

var consts = require('../../consts.js');
var scheme = {
	$id: 'http://management/volumes/rebuildvolumes.js',
	properties: {
		body: {
			type: 'array',
			items: {
				type: 'object',
				properties: {
					_id: { $ref: consts.MANAGEMENT_DEFINITIONS + '/volumeName.js' },
					uuid: { $ref: consts.MANAGEMENT_DEFINITIONS + '/uuid.js' },
					allowAllocationOnOfflineDrives: { type: 'boolean', default: false }
				},
				required: ['_id', 'uuid'],
			},
			minItems: 1
		}
	},
	required: ['body']
};

module.exports = scheme;
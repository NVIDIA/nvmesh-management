/*
 * SPDX-FileCopyrightText: Copyright (c) 2026 NVIDIA CORPORATION & AFFILIATES. All rights reserved.
 * SPDX-License-Identifier: Apache-2.0
 */

var consts = require('../../consts.js');
var scheme = {
	$id: consts.MANAGEMENT_DEFINITIONS + '/diskClass.js',
	type: 'object',
	properties: {
		disks: {
			type: 'array',
			items: {
				$ref: consts.MANAGEMENT_DEFINITIONS + '/disk.js'
			},
			minItems: 1,
			uniqueItemProperties: ['diskID']
		},
		_id: { $ref: consts.MANAGEMENT_DEFINITIONS + '/className.js' },
		description: { $ref: consts.MANAGEMENT_DEFINITIONS + '/description.js' },
		domains: {
			type: 'array',
			items: {
				$ref: consts.MANAGEMENT_DEFINITIONS + '/domain.js'
			}
		}
	},
	required: ['_id', 'disks']
};
module.exports = scheme;
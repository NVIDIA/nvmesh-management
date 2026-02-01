/*
 * SPDX-FileCopyrightText: Copyright (c) 2026 NVIDIA CORPORATION & AFFILIATES. All rights reserved.
 * SPDX-License-Identifier: Apache-2.0
 */

var consts = require('../../consts.js');
var scheme = {
	$id: consts.MANAGEMENT_DEFINITIONS + '/serverClass.js',
	type: 'object',
	properties: {
		targetNodes: {
			type: 'array',
			items: { $ref: consts.MANAGEMENT_DEFINITIONS + '/targetName.js' },
			minItems: 1,
			uniqueItems: true
		},
		description: { $ref: consts.MANAGEMENT_DEFINITIONS + '/description.js' },
		name: { $ref: consts.MANAGEMENT_DEFINITIONS + '/className.js' },
		domains: {
			type: 'array',
			items: { $ref: consts.MANAGEMENT_DEFINITIONS + '/domain.js' }
		}
	},
	required: ['targetNodes', 'name']

};
module.exports = scheme;
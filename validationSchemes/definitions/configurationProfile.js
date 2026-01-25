/*
 * SPDX-FileCopyrightText: Copyright (c) 2026 NVIDIA CORPORATION & AFFILIATES. All rights reserved.
 * SPDX-License-Identifier: Apache-2.0
 */

var consts = require('../../consts.js');
var scheme = {
	$id: consts.MANAGEMENT_DEFINITIONS + '/configurationProfile.js',
	type: 'object',
	properties: {
		name: { type: 'string' },
		uuid: { $ref: consts.MANAGEMENT_DEFINITIONS + '/uuid.js' },
		labels: {
			type: 'array',
			items: { type: 'string' }
		},
		description: { $ref: consts.MANAGEMENT_DEFINITIONS + '/description.js' },
		config: { type: 'object' }
	},
	required: ['name']
};

module.exports = scheme;
/*
 * SPDX-FileCopyrightText: Copyright (c) 2026 NVIDIA CORPORATION & AFFILIATES. All rights reserved.
 * SPDX-License-Identifier: Apache-2.0
 */

const consts = require('../../consts.js');

const schema = {
	$id: consts.MANAGEMENT_DEFINITIONS + '/artifact.js',
	type: 'object',
	properties: {
		name: {
			type: 'string',
			maxLength: 1024,
			pattern: '^[a-zA-Z0-9_.*-]*$'
		},
		platforms: {
			type: 'array',
			items: { $ref: consts.MANAGEMENT_DEFINITIONS + '/platform.js' }
		}
	},
	required: ['name']
};

module.exports = schema;
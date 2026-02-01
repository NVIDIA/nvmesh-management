/*
 * SPDX-FileCopyrightText: Copyright (c) 2026 NVIDIA CORPORATION & AFFILIATES. All rights reserved.
 * SPDX-License-Identifier: Apache-2.0
 */

const consts = require('../../consts');

const schema = {
	$id: 'http://management/definitions/release.js',
	type: 'object',
	properties: {
		version: { $ref: consts.MANAGEMENT_DEFINITIONS + '/version.js' },
		artifacts: {
			type: 'array',
			items: {
				type: 'object',
				properties: {
					ID: { type: 'integer' }
				},
				required: ['ID']
			},
		}
	},
	required: ['version']
};

module.exports = schema;
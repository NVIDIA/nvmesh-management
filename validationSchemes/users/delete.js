/*
 * SPDX-FileCopyrightText: Copyright (c) 2026 NVIDIA CORPORATION & AFFILIATES. All rights reserved.
 * SPDX-License-Identifier: Apache-2.0
 */

let consts = require('../../consts.js');

let scheme = {
	$id: 'http://management/users/delete.js',
	properties: {
		body: {
			type: 'array',
			items: {
				type: 'object',
				properties: {
					_id: { type: 'string', format: 'email' },
					uuid: { $ref: consts.MANAGEMENT_DEFINITIONS + '/uuid.js' }
				},
				required: ['_id', 'uuid']
			},
			minItems: 1
		}
	},
	required: ['body']
};

module.exports = scheme;
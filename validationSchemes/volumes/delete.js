/*
 * SPDX-FileCopyrightText: Copyright (c) 2026 NVIDIA CORPORATION & AFFILIATES. All rights reserved.
 * SPDX-License-Identifier: Apache-2.0
 */

var consts = require('../../consts.js');
var scheme = {
	$id: 'http://management/volumes/delete.js',
	properties: {
		body: {
			type: 'array',
			items: {
				type: 'object',
				properties: {
					_id: { $ref: consts.MANAGEMENT_DEFINITIONS + '/volumeName.js' },
					uuid: { $ref: consts.MANAGEMENT_DEFINITIONS + '/uuid.js' }
				},
				required: ['_id', 'uuid']
			},
			minItems: 1
		}
	}
};

module.exports = scheme;
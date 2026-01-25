/*
 * SPDX-FileCopyrightText: Copyright (c) 2026 NVIDIA CORPORATION & AFFILIATES. All rights reserved.
 * SPDX-License-Identifier: Apache-2.0
 */

var consts = require('../../consts.js');

var scheme = {
	$id: 'http://management/volumeprovisioninggroups/extend.js',
	properties: {
		body: {
			type: 'array',
			items: {
				type: 'object',
				properties: {
					_id: { $ref: consts.MANAGEMENT_DEFINITIONS + '/vpgName.js' },
					uuid: { $ref: consts.MANAGEMENT_DEFINITIONS + '/uuid.js' },
					capacity: { $ref: consts.MANAGEMENT_DEFINITIONS + '/capacityNumber.js' },
				},
				required: ['_id', 'uuid', 'capacity']
			},
			minItems: 1
		}
	},
	required: ['body']
};

module.exports = scheme;
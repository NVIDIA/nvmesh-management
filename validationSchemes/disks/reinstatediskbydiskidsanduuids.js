/*
 * SPDX-FileCopyrightText: Copyright (c) 2026 NVIDIA CORPORATION & AFFILIATES. All rights reserved.
 * SPDX-License-Identifier: Apache-2.0
 */

let consts = require('../../consts.js');

let scheme = {
	$id: 'http://management/disks/reinstatediskbydiskidsanduuids.js',
	properties: {
		body: {
			type: 'array',
			items: {
				type: 'object',
				properties: {
					uuid: { $ref: consts.MANAGEMENT_DEFINITIONS + '/uuid.js' },
					diskID: { $ref: consts.MANAGEMENT_DEFINITIONS + '/diskName.js' }
				},
				required: ['diskID', 'uuid']
			},
			minItems: 1
		}
	}
};

module.exports = scheme;

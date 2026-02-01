/*
 * SPDX-FileCopyrightText: Copyright (c) 2026 NVIDIA CORPORATION & AFFILIATES. All rights reserved.
 * SPDX-License-Identifier: Apache-2.0
 */

const consts = require('../../consts');

var scheme = {
	$id: 'http://management/servers/setzone.js',
	properties: {
		body: {
			type: 'object',
			properties: {
				zoneID: {
					type: 'integer',
					minimum: 1
				},
				targets: {
					type: 'array',
					items: {
						type: 'object',
						properties: {
							_id: { $ref: consts.MANAGEMENT_DEFINITIONS + '/objectID.js#/properties/_id' },
							uuid: { $ref: consts.MANAGEMENT_DEFINITIONS + '/uuid.js' }
						},
						required: ['_id', 'uuid']
					},
					minItems: 1
				},
			},
			required: ['zoneID', 'targets']
		}
	}
};

module.exports = scheme;
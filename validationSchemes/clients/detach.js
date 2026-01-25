/*
 * SPDX-FileCopyrightText: Copyright (c) 2026 NVIDIA CORPORATION & AFFILIATES. All rights reserved.
 * SPDX-License-Identifier: Apache-2.0
 */

var consts = require('../../consts.js');
var scheme = {
	$id: 'http://management/clients/detach.js',
	properties: {
		body: {
			type: 'object',
			properties: {
				client: { $ref: consts.MANAGEMENT_DEFINITIONS + '/objectID.js#/properties/_id' },
				clientUUID: { $ref: consts.MANAGEMENT_DEFINITIONS + '/uuid.js' },
				volumes: {
					type: 'array',
					items: {
						type: 'object',
						properties: {
							name: { $ref: consts.MANAGEMENT_DEFINITIONS + '/volumeName.js' },
							uuid: { $ref: consts.MANAGEMENT_DEFINITIONS + '/uuid.js' },
							referenceID: { $ref: consts.MANAGEMENT_DEFINITIONS + '/referenceID.js' }
						},
						required: ['name', 'uuid']
					},
					minItems: 1
				},
				force: { type: 'boolean' }
			},
			required: ['client', 'clientUUID', 'volumes']
		}
	},
	required: ['body']
};

module.exports = scheme;

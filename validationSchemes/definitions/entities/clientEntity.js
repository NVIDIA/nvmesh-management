/*
 * SPDX-FileCopyrightText: Copyright (c) 2026 NVIDIA CORPORATION & AFFILIATES. All rights reserved.
 * SPDX-License-Identifier: Apache-2.0
 */

var consts = require('../../../consts.js');
var scheme = {
	$id: consts.MANAGEMENT_DEFINITIONS_ENTITIES + '/clientEntity.js',
	type: 'object',
	properties: {
		_id: { type: 'string' },
		client_id: { type: 'string' },
		health: { type: 'string' },
		configuration_version: { type: 'integer' },
		client_status: { type: 'integer' },
		block_devices: {
			type: 'array',
			items: {
				$ref: consts.MANAGEMENT_DEFINITIONS_ENTITIES + '/blockDeviceEntity.js'
			}
		},
		version: { type: 'string' },
		commit: { type: 'string' },
		managementAgentStatus: { type: 'string' },
		messageSequence: { type: 'integer' },
		dateModified: { type: 'string' }
	},
	required: []
};

scheme.required = Object.keys(scheme.properties);

module.exports = scheme;
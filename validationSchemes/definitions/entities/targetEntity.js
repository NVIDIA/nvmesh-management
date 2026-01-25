/*
 * SPDX-FileCopyrightText: Copyright (c) 2026 NVIDIA CORPORATION & AFFILIATES. All rights reserved.
 * SPDX-License-Identifier: Apache-2.0
 */

var consts = require('../../../consts.js');
var scheme = {
	$id: consts.MANAGEMENT_DEFINITIONS_ENTITIES + '/targetEntity.js',
	type: 'object',
	properties: {
		_id: { type: 'string' },
		node_id: { type: 'string' },
		uuid: { type: 'string' },
		branch: { type: 'string' },
		health: { enum: [consts.targetHealth.ALARM, consts.targetHealth.CRITICAL, consts.targetHealth.HEALTHY] },
		node_status: { type: 'integer' },
		disks: {
			type: 'array',
			items: {
				$ref: consts.MANAGEMENT_DEFINITIONS_ENTITIES + '/driveEntity.js'
			}
		},
		nics: {
			type: 'array',
			items: {
				$ref: consts.MANAGEMENT_DEFINITIONS_ENTITIES + '/nicEntity.js'
			}
		},
		version: { type: 'string' },
		commit: { type: 'string' },
		tomaStatus: { type: 'string' },
		messageSequence: { type: 'integer' },
		dateModified: { type: 'string' },
		cpu_temp: { type: 'string' },
		cpu_load: { type: 'string' },
		//zone: { type: 'string' }
	},
	required: []
};

scheme.required = Object.keys(scheme.properties);

module.exports = scheme;
/*
 * SPDX-FileCopyrightText: Copyright (c) 2026 NVIDIA CORPORATION & AFFILIATES. All rights reserved.
 * SPDX-License-Identifier: Apache-2.0
 */

var consts = require('../../../consts.js');
var scheme = {
	$id: consts.MANAGEMENT_DEFINITIONS_ENTITIES + '/driveEntity.js',
	type: 'object',
	properties: {
		diskID: { $ref: consts.MANAGEMENT_DEFINITIONS + '/diskName.js' },
		//node_id: { $ref: consts.MANAGEMENT_DEFINITIONS + '/targetName.js' },
		isExcluded: { type: 'boolean' },
		isPendingFormat: { type: 'boolean' },
		GPT: { type: 'object' },
		block_size: { type: 'integer' },
		Vendor: { type: 'string' },
		reappearingCounter: { type: 'integer' },
		metadata_size: { type: 'integer' },
		Serial_Number: { type: 'string' },
		status: { type: 'string' },
		blocks: { type: 'integer' },
		formatRequestCounter: { type: 'integer' },
		Model: { type: 'string' },
		formatOptions: { type: 'array' },
		availableBlocks: { type: 'integer' },
		usableBlocks: { type: 'integer' },
		largestSegmentAvailable: { type: 'object' },
		health: { type: 'string' },
		diskSegments: {
			type: 'array',
			items: {
				$ref: consts.MANAGEMENT_DEFINITIONS_ENTITIES + '/diskSegmentEntity.js'
			}
		}
	},
	required: []
};

scheme.required = Object.keys(scheme.properties);

module.exports = scheme;
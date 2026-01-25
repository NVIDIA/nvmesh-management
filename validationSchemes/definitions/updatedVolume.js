/*
 * SPDX-FileCopyrightText: Copyright (c) 2026 NVIDIA CORPORATION & AFFILIATES. All rights reserved.
 * SPDX-License-Identifier: Apache-2.0
 */

const consts = require('../../consts.js');
const { classesScheme, limitByDisksScheme, limitByNodesScheme, limitationsDependencies } = require('../common/volumeLimitations.js');

const scheme = {
	$id: consts.MANAGEMENT_DEFINITIONS + '/updatedVolume.js',
	type: 'object',
	unevaluatedProperties: false,
	properties: {
		_id: { $ref: consts.MANAGEMENT_DEFINITIONS + '/volumeName.js' },
		uuid: { $ref: consts.MANAGEMENT_DEFINITIONS + '/uuid.js' },
		description: { $ref: consts.MANAGEMENT_DEFINITIONS + '/description.js' },
		relativeRebuildPriority: { $ref: consts.MANAGEMENT_DEFINITIONS + '/relativeRebuildPriority.js' },
		enableNVMf: { type: 'boolean' },
		isReadOnly: { type: 'boolean' },
		allowAllocationOnOfflineDrives: { type: 'boolean' },
		diskClasses: classesScheme,
		serverClasses: classesScheme,
		limitByDisks: limitByDisksScheme,
		limitByNodes: limitByNodesScheme,
		enableCrcCheck: { type: 'boolean' },
		VSGs: { $ref: consts.MANAGEMENT_DEFINITIONS + '/vsgNamesList.js' },
		metadata: { $ref: consts.MANAGEMENT_DEFINITIONS + '/volumeMetadata.js' },
	},
	if: { properties: { enableNVMf: { const: true } }, required: ['enableNVMf'] },
	then: {
		properties: {
			_id: { $ref: consts.MANAGEMENT_DEFINITIONS + '/volumeNameWithNVMFAccess.js' },
			selectedClientsForNvmf: { type: 'array', items: { type: 'string' } }
		},
		required: ['selectedClientsForNvmf']
	},
	else: { properties: { _id: { $ref: consts.MANAGEMENT_DEFINITIONS + '/volumeName.js' } } },
	required: ['_id', 'uuid'],
	dependencies: limitationsDependencies,
};

module.exports = scheme;

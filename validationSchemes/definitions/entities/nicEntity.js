/*
 * SPDX-FileCopyrightText: Copyright (c) 2026 NVIDIA CORPORATION & AFFILIATES. All rights reserved.
 * SPDX-License-Identifier: Apache-2.0
 */

var consts = require('../../../consts.js');
var scheme = {
	$id: consts.MANAGEMENT_DEFINITIONS_ENTITIES + '/nicEntity.js',
	type: 'object',
	properties: {
		uuid: { type: 'string' },
		nicID: { $ref: consts.MANAGEMENT_DEFINITIONS + '/nicID.js' },
		status: { type: 'string' },
		pkey: { type: 'integer' },
		deviceType: { type: 'string' },
		pci_root: { type: 'integer' },
		protocol: { type: 'string' },
		guid: { type: 'string' },
		mtu: { type: 'integer' },
		nodeID: { type: 'string' },
		nodeUUID: { type: 'string' },
		version: { type: 'integer' },
		health: { type: 'string' }
	},
	required: []
};

scheme.required = Object.keys(scheme.properties);

module.exports = scheme;
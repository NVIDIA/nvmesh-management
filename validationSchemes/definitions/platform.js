/*
 * SPDX-FileCopyrightText: Copyright (c) 2026 NVIDIA CORPORATION & AFFILIATES. All rights reserved.
 * SPDX-License-Identifier: Apache-2.0
 */

const consts = require('../../consts.js');

const schema = {
	$id: consts.MANAGEMENT_DEFINITIONS + '/platform.js',
	type: 'object',
	properties: {
		name: { type: 'string' },
		description: { $ref: consts.MANAGEMENT_DEFINITIONS + '/description.js' },
		archTypeID: { type: 'integer' },
		operatingSystemID: { type: 'integer' },
		kernelID: { type: 'integer' },
		ofedID: { type: 'integer' }
	},
	required: ['name', 'archTypeID', 'operatingSystemID', 'kernelID', 'ofedID']
};

module.exports = schema;
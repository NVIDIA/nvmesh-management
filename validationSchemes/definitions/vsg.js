/*
 * SPDX-FileCopyrightText: Copyright (c) 2026 NVIDIA CORPORATION & AFFILIATES. All rights reserved.
 * SPDX-License-Identifier: Apache-2.0
 */

var consts = require('../../consts.js');
var scheme = {
	$id: consts.MANAGEMENT_DEFINITIONS + '/vsg.js',
	type: 'object',
	properties: {
		_id: { $ref: consts.MANAGEMENT_DEFINITIONS + '/vsgName.js' },
		description: { $ref: consts.MANAGEMENT_DEFINITIONS + '/description.js' },
		keys: {
			type: 'array',
			items: { type: 'string' }
		}
	},
	required: ['_id']

};
module.exports = scheme;
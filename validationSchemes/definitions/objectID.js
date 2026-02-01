/*
 * SPDX-FileCopyrightText: Copyright (c) 2026 NVIDIA CORPORATION & AFFILIATES. All rights reserved.
 * SPDX-License-Identifier: Apache-2.0
 */

var consts = require('../../consts.js');
var scheme = {
	$id: consts.MANAGEMENT_DEFINITIONS + '/objectID.js',
	type: 'object',
	properties: {
		_id: {
			type: 'string'
		}
	},
	required: ['_id']
};

module.exports = scheme;
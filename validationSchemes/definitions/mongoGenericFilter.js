/*
 * SPDX-FileCopyrightText: Copyright (c) 2026 NVIDIA CORPORATION & AFFILIATES. All rights reserved.
 * SPDX-License-Identifier: Apache-2.0
 */

var consts = require('../../consts.js');
var scheme = {
	$id: consts.MANAGEMENT_DEFINITIONS + '/mongoGenericFilter.js',
	type: 'object',
	properties: {
		filter: {
			type: 'string',
			format: 'json'
		}
	}
};

module.exports = scheme;
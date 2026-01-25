/*
 * SPDX-FileCopyrightText: Copyright (c) 2026 NVIDIA CORPORATION & AFFILIATES. All rights reserved.
 * SPDX-License-Identifier: Apache-2.0
 */

var consts = require('../../consts.js');
var scheme = {
	$id: 'http://management/clients/count.js',
	properties: {
		query: { $ref: consts.MANAGEMENT_DEFINITIONS + '/mongoGenericFilter.js' }
	}
};

module.exports = scheme;
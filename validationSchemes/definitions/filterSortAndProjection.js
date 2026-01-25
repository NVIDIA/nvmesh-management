/*
 * SPDX-FileCopyrightText: Copyright (c) 2026 NVIDIA CORPORATION & AFFILIATES. All rights reserved.
 * SPDX-License-Identifier: Apache-2.0
 */

var consts = require('../../consts.js');
var scheme = {
	$id: consts.MANAGEMENT_DEFINITIONS + '/filterSortAndProjection.js',
	type: 'object',
	properties: {
		filter: { $ref: consts.MANAGEMENT_DEFINITIONS + '/jsonObject.js' },
		sort: { $ref: consts.MANAGEMENT_DEFINITIONS + '/jsonObject.js' },
		projection: { $ref: consts.MANAGEMENT_DEFINITIONS + '/jsonObject.js' }
	}
};

module.exports = scheme;
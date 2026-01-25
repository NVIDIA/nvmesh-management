/*
 * SPDX-FileCopyrightText: Copyright (c) 2026 NVIDIA CORPORATION & AFFILIATES. All rights reserved.
 * SPDX-License-Identifier: Apache-2.0
 */

const consts = require('../../consts.js');
const scheme = {
	$id: 'http://management/upgradestepsscenarios/count.js',
	properties: {
		query: { $ref: consts.MANAGEMENT_DEFINITIONS + '/mongoGenericFilter.js' }
	}
};

module.exports = scheme;


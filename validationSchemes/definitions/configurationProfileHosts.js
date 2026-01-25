/*
 * SPDX-FileCopyrightText: Copyright (c) 2026 NVIDIA CORPORATION & AFFILIATES. All rights reserved.
 * SPDX-License-Identifier: Apache-2.0
 */

var consts = require('../../consts.js');
var scheme = {
	$id: consts.MANAGEMENT_DEFINITIONS + '/configurationProfileHosts.js',
	type: 'array',
	items: { $ref: consts.MANAGEMENT_DEFINITIONS + '/targetName.js' }
};
module.exports = scheme;
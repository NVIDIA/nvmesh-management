/*
 * SPDX-FileCopyrightText: Copyright (c) 2026 NVIDIA CORPORATION & AFFILIATES. All rights reserved.
 * SPDX-License-Identifier: Apache-2.0
 */

var consts = require('../../consts.js');
// User-facing volume name. Reserved suffix '-mgmt' is excluded so that
// satellite (CDV_MGMT) names cannot collide with user-created volumes.
var scheme = {
	$id: consts.MANAGEMENT_DEFINITIONS + '/volumeName.js',
	type: 'string',
	pattern: '^(?!e_|d_)[\\w+=-]*$',
	maxLength: 22,
	minLength: 1,
	not: { pattern: consts.CDV_MGMT_SUFFIX + '$' }
};

module.exports = scheme;
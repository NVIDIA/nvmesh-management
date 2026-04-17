/*
 * SPDX-FileCopyrightText: Copyright (c) 2026 NVIDIA CORPORATION & AFFILIATES. All rights reserved.
 * SPDX-License-Identifier: Apache-2.0
 */

// Stricter than the regular volumeName scheme: a CDV name must be short enough
// that '<cdvName>-mgmt' (the satellite volume's name) still fits within the
// regular volume name limit. Same character set as regular volume names.
var consts = require('../../consts.js');
var scheme = {
	$id: consts.MANAGEMENT_DEFINITIONS + '/cdvVolumeName.js',
	type: 'string',
	pattern: '^(?!e_|d_)[\\w+=-]*$',
	maxLength: consts.CDV_NAME_MAX_LENGTH,
	minLength: 1,
	not: { pattern: consts.CDV_MGMT_SUFFIX + '$' }
};

module.exports = scheme;

/*
 * SPDX-FileCopyrightText: Copyright (c) 2026 NVIDIA CORPORATION & AFFILIATES. All rights reserved.
 * SPDX-License-Identifier: Apache-2.0
 */

var consts = require('../../consts.js');
var scheme = {
	$id: consts.MANAGEMENT_DEFINITIONS + '/volumeName.js',
	type: 'string',
	pattern: '^(?!e_|d_)[\\w+=-]*$',
	maxLength: 22,
	minLength: 1
};

module.exports = scheme;
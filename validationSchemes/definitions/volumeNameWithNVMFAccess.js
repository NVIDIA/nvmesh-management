/*
 * SPDX-FileCopyrightText: Copyright (c) 2026 NVIDIA CORPORATION & AFFILIATES. All rights reserved.
 * SPDX-License-Identifier: Apache-2.0
 */

var consts = require('../../consts.js');
var scheme = {
	$id: consts.MANAGEMENT_DEFINITIONS + '/volumeNameWithNVMFAccess.js',
	type: 'string',
	pattern: '^[a-zA-Z0-9+-=]{1,24}$'
};

module.exports = scheme;
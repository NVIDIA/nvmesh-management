/*
 * SPDX-FileCopyrightText: Copyright (c) 2026 NVIDIA CORPORATION & AFFILIATES. All rights reserved.
 * SPDX-License-Identifier: Apache-2.0
 */

var consts = require('../../consts.js');
var scheme = {
	$id: consts.MANAGEMENT_DEFINITIONS + '/description.js',
	anyOf: [{ type: 'string', maxLength: 1024 }, { type: 'null' }]
};

module.exports = scheme;
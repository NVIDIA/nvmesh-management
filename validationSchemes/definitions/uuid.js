/*
 * SPDX-FileCopyrightText: Copyright (c) 2026 NVIDIA CORPORATION & AFFILIATES. All rights reserved.
 * SPDX-License-Identifier: Apache-2.0
 */

let consts = require('../../consts.js');

let scheme = {
	$id: consts.MANAGEMENT_DEFINITIONS + '/uuid.js',
	type: 'string',
	format: 'uuid'
};

module.exports = scheme;
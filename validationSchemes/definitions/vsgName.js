/*
 * SPDX-FileCopyrightText: Copyright (c) 2026 NVIDIA CORPORATION & AFFILIATES. All rights reserved.
 * SPDX-License-Identifier: Apache-2.0
 */

const consts = require('../../consts.js');

const scheme = {
	$id: consts.MANAGEMENT_DEFINITIONS + '/vsgName.js',
	type: 'string',
	maxLength: 1024
};

module.exports = scheme;	
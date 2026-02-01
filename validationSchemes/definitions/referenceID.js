/*
 * SPDX-FileCopyrightText: Copyright (c) 2026 NVIDIA CORPORATION & AFFILIATES. All rights reserved.
 * SPDX-License-Identifier: Apache-2.0
 */

const consts = require('../../consts.js');
const scheme = {
	$id: consts.MANAGEMENT_DEFINITIONS + '/referenceID.js',
	type: 'string',
	minLength: 1,
	maxLength: 63,
	pattern: '^[a-z0-9-]+$'
};

module.exports = scheme;
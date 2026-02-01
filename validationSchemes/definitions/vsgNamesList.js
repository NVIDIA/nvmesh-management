/*
 * SPDX-FileCopyrightText: Copyright (c) 2026 NVIDIA CORPORATION & AFFILIATES. All rights reserved.
 * SPDX-License-Identifier: Apache-2.0
 */

const consts = require('../../consts.js');

const scheme = {
	$id: consts.MANAGEMENT_DEFINITIONS + '/vsgNamesList.js',
	type: 'array',
	items: { $ref: consts.MANAGEMENT_DEFINITIONS + '/vsgName.js' },
	minItems: 0
};

module.exports = scheme;
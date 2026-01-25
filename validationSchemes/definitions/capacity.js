/*
 * SPDX-FileCopyrightText: Copyright (c) 2026 NVIDIA CORPORATION & AFFILIATES. All rights reserved.
 * SPDX-License-Identifier: Apache-2.0
 */

var consts = require('../../consts.js');
var scheme = {
	$id: consts.MANAGEMENT_DEFINITIONS + '/capacity.js',
	anyOf: [
		{ $ref: consts.MANAGEMENT_DEFINITIONS + '/capacityNumber.js' },
		{ const: consts.volumeCapacity.MAX },
		{ const: consts.volumeCapacity.NO_CHANGE }
	]
};

module.exports = scheme;
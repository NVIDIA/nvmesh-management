/*
 * SPDX-FileCopyrightText: Copyright (c) 2026 NVIDIA CORPORATION & AFFILIATES. All rights reserved.
 * SPDX-License-Identifier: Apache-2.0
 */

const consts = require('../../consts.js');

const scheme = {
	$id: consts.MANAGEMENT_DEFINITIONS + '/volumes/getSegmentsStatusByDisk.js',
	properties: {
		nodeID: { $ref: consts.MANAGEMENT_DEFINITIONS + '/targetName.js' },
		diskID: { $ref: consts.MANAGEMENT_DEFINITIONS + '/diskName.js' }
	},
	required: ['nodeID', 'diskID']
};

module.exports = scheme;
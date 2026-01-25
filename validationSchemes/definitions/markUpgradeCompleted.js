/*
 * SPDX-FileCopyrightText: Copyright (c) 2026 NVIDIA CORPORATION & AFFILIATES. All rights reserved.
 * SPDX-License-Identifier: Apache-2.0
 */

const consts = require('../../consts');

const schema = {
	$id: consts.MANAGEMENT_DEFINITIONS + '/markUpgradeCompleted.js',
	type: 'object',
	properties: {
		upgradeStepID: { type: 'string' },
	},
	required: ['upgradeStepID']
};

module.exports = schema;

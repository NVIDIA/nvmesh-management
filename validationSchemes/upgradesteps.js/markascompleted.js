/*
 * SPDX-FileCopyrightText: Copyright (c) 2026 NVIDIA CORPORATION & AFFILIATES. All rights reserved.
 * SPDX-License-Identifier: Apache-2.0
 */

const consts = require('../../consts');

const schema = {
	$id: 'http://management/upgrades/markascompleted.js',
	properties: {
		body: {
			$ref: consts.MANAGEMENT_DEFINITIONS + '/markUpgradeCompleted.js'
		}
	},
	required: ['body']
};

module.exports = schema;

/*
 * SPDX-FileCopyrightText: Copyright (c) 2026 NVIDIA CORPORATION & AFFILIATES. All rights reserved.
 * SPDX-License-Identifier: Apache-2.0
 */

var consts = require('../../consts.js');

let updateScheme = {
	$id: 'http://management/generalsettings/update.js',
	properties: {
		body: { $ref: consts.MANAGEMENT_DEFINITIONS + '/generalSettings.js' }
	},
	required: ['body']
};

module.exports = updateScheme;
/*
 * SPDX-FileCopyrightText: Copyright (c) 2026 NVIDIA CORPORATION & AFFILIATES. All rights reserved.
 * SPDX-License-Identifier: Apache-2.0
 */

let consts = require('../../consts.js');

let updateScheme = {
	$id: 'http://management/configurationprofiles/update.js',
	properties: {
		body: {
			type: 'array',
			items: {
				$ref: consts.MANAGEMENT_DEFINITIONS + '/configurationProfile.js',
				required: ['name', 'uuid']
			},
			minItems: 1
		}
	},
	required: ['body']
};

module.exports = updateScheme;
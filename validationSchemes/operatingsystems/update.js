/*
 * SPDX-FileCopyrightText: Copyright (c) 2026 NVIDIA CORPORATION & AFFILIATES. All rights reserved.
 * SPDX-License-Identifier: Apache-2.0
 */

const consts = require('../../consts');

const schema = {
	$id: 'http://management/operatingSystems/update.js',
	properties: {
		body: {
			type: 'array',
			items: { $ref: consts.MANAGEMENT_DEFINITIONS + '/operatingSystemWithID.js' },
			minItems: 1
		}
	},
	required: ['body']
};

module.exports = schema;

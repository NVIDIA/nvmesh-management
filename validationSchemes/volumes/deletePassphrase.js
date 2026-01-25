/*
 * SPDX-FileCopyrightText: Copyright (c) 2026 NVIDIA CORPORATION & AFFILIATES. All rights reserved.
 * SPDX-License-Identifier: Apache-2.0
 */

var consts = require('../../consts.js');
var scheme = {
	$id: 'http://management/volumes/deletepassphrase.js',
	properties: {
		body: {
			type: 'array',
			items: {
				type: 'object',
				properties: {
					_id: { $ref: `${consts.MANAGEMENT_DEFINITIONS}/volumeName.js` },
					uuid: { $ref: `${consts.MANAGEMENT_DEFINITIONS}/uuid.js` },
					currentPassphrase: { $ref: `${consts.MANAGEMENT_DEFINITIONS}/passphrase.js` }
				},
				required: ['_id', 'uuid', 'currentPassphrase'],
			},
			minItems: 1
		}
	},
	required: ['body']
};

module.exports = scheme;
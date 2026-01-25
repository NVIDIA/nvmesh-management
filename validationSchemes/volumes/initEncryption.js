/*
 * SPDX-FileCopyrightText: Copyright (c) 2026 NVIDIA CORPORATION & AFFILIATES. All rights reserved.
 * SPDX-License-Identifier: Apache-2.0
 */

var consts = require('../../consts.js');
var scheme = {
	$id: 'http://management/volumes/initencryption.js',
	properties: {
		body: {
			type: 'array',
			items: {
				type: 'object',
				properties: {
					_id: { $ref: `${consts.MANAGEMENT_DEFINITIONS}/volumeName.js` },
					uuid: { $ref: `${consts.MANAGEMENT_DEFINITIONS}/uuid.js` },
					passphrase: { $ref: `${consts.MANAGEMENT_DEFINITIONS}/passphrase.js` },
					slot: { type: 'integer', minimum: 1, maximum: 32, default: 1 },
					keySize: { enum: [consts.XTS_KEY_SIZES.XTS_AES_128, consts.XTS_KEY_SIZES.XTS_AES_256], default: consts.XTS_KEY_SIZES.XTS_AES_256 }
				},
				required: ['_id', 'uuid', 'passphrase'],
			},
			minItems: 1
		}
	},
	required: ['body']
};

module.exports = scheme;
/*
 * SPDX-FileCopyrightText: Copyright (c) 2026 NVIDIA CORPORATION & AFFILIATES. All rights reserved.
 * SPDX-License-Identifier: Apache-2.0
 */

let consts = require('../../consts.js');

let updateScheme = {
	$id: 'http://management/configurationprofiles/apply.js',
	properties: {
		body: {
			type: 'object',
			properties: {
				name: { type: 'string' },
				uuid: { $ref: consts.MANAGEMENT_DEFINITIONS + '/uuid.js' },
				nodeIDs: {
					type: 'array',
					items: {
						type: 'string'
					}
				}

			}
		}
	},
	required: ['body']
};

module.exports = updateScheme;

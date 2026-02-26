/*
 * SPDX-FileCopyrightText: Copyright (c) 2026 NVIDIA CORPORATION & AFFILIATES. All rights reserved.
 * SPDX-License-Identifier: Apache-2.0
 */

const schema = {
	$id: 'http://management/upgrades/getpossibleupgradesbyhostnames.js',
	type: 'object',
	properties: {
		body: {
			type: 'object',
			properties: {
				hostnames: {
					type: 'array',
					items: { type: 'string' },
					minItems: 1
				},
				components: {
					type: 'array',
					items: { type: 'string' }
				}
			},
			required: ['hostnames']
		}
	}
};

module.exports = schema;

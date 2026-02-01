/*
 * SPDX-FileCopyrightText: Copyright (c) 2026 NVIDIA CORPORATION & AFFILIATES. All rights reserved.
 * SPDX-License-Identifier: Apache-2.0
 */

const schema = {
	$id: 'http://management/operatingsystems/delete.js',
	properties: {
		body: {
			type: 'array',
			items: {
				type: 'object',
				properties: {
					ID: { type: 'integer' },
					version: { type: 'string' }
				},
				required: ['ID', 'version']
			},
			minItems: 1
		}
	},
	required: ['body']
};

module.exports = schema;

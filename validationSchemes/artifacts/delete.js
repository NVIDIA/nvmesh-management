/*
 * SPDX-FileCopyrightText: Copyright (c) 2026 NVIDIA CORPORATION & AFFILIATES. All rights reserved.
 * SPDX-License-Identifier: Apache-2.0
 */

const schema = {
	$id: 'http://management/artifacts/delete.js',
	properties: {
		body: {
			type: 'array',
			minItems: 1,
			items: {
				type: 'object',
				properties: {
					ID: { type: 'integer' },
					name: { type: 'string' }
				},
				required: ['ID', 'name']
			}
		}
	},
	required: ['body']
};

module.exports = schema;
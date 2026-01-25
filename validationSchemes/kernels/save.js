/*
 * SPDX-FileCopyrightText: Copyright (c) 2026 NVIDIA CORPORATION & AFFILIATES. All rights reserved.
 * SPDX-License-Identifier: Apache-2.0
 */

const schema = {
	$id: 'http://management/kernels/save.js',
	properties: {
		body: {
			type: 'array',
			items: { type: 'string' },
			minItems: 1
		}
	},
	required: ['body']
};

module.exports = schema;
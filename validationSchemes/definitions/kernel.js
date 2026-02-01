/*
 * SPDX-FileCopyrightText: Copyright (c) 2026 NVIDIA CORPORATION & AFFILIATES. All rights reserved.
 * SPDX-License-Identifier: Apache-2.0
 */

const schema = {
	$id: 'http://management/definitions/kernel.js',
	type: 'object',
	properties: {
		ID: { type: 'integer' },
		version: { type: 'string' }
	},
	required: ['ID', 'version']
};

module.exports = schema;
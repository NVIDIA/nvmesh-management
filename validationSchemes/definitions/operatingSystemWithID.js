/*
 * SPDX-FileCopyrightText: Copyright (c) 2026 NVIDIA CORPORATION & AFFILIATES. All rights reserved.
 * SPDX-License-Identifier: Apache-2.0
 */

const osBase = require('./operatingSystem');

const schema = {
	$id: 'http://management/definitions/operatingSystemWithID.js',
	type: 'object',
	properties: {
		ID: { type: 'integer' },
		...osBase.properties
	},
	required: ['ID', ...osBase.required]
};

module.exports = schema;

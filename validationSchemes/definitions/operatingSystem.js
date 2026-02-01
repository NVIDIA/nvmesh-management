/*
 * SPDX-FileCopyrightText: Copyright (c) 2026 NVIDIA CORPORATION & AFFILIATES. All rights reserved.
 * SPDX-License-Identifier: Apache-2.0
 */

const schema = {
	$id: 'http://management/definitions/operatingSystem.js',
	type: 'object',
	properties: {
		version: { type: 'string' },
		distributionTypeID: { type: 'integer' }
	},
	required: ['version', 'distributionTypeID']
};

module.exports = schema;

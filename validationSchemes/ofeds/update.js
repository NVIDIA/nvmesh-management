/*
 * SPDX-FileCopyrightText: Copyright (c) 2026 NVIDIA CORPORATION & AFFILIATES. All rights reserved.
 * SPDX-License-Identifier: Apache-2.0
 */

const schema = {
	$id: 'http://management/ofeds/update.js',
	properties: {
		body: {
			type: 'array',
			items: { $ref: 'http://management/definitions/ofed.js' },
			minItems: 1
		}
	},
	required: ['body']
};

module.exports = schema;
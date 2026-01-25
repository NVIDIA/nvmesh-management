/*
 * SPDX-FileCopyrightText: Copyright (c) 2026 NVIDIA CORPORATION & AFFILIATES. All rights reserved.
 * SPDX-License-Identifier: Apache-2.0
 */

var scheme = {
	$id: 'http://management/login.js',
	properties: {
		body: {
			type: 'object',
			properties: {
				username: { type: 'string' },
				password: { type: 'string' }
			},
			required: ['username', 'password']
		}
	},
	required: ['body']
};

module.exports = scheme;
/*
 * SPDX-FileCopyrightText: Copyright (c) 2026 NVIDIA CORPORATION & AFFILIATES. All rights reserved.
 * SPDX-License-Identifier: Apache-2.0
 */

const userScheme = require('../definitions/user.js');

const scheme = {
	$id: 'http://management/users/changepassword.js',
	properties: {
		body: {
			type: 'object',
			properties: {
				password: userScheme.properties.password,
				confirmationPassword: userScheme.properties.confirmationPassword
			},
			required: ['password', 'confirmationPassword']
		}
	},
	required: ['body']
};

module.exports = scheme;
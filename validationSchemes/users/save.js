/*
 * SPDX-FileCopyrightText: Copyright (c) 2026 NVIDIA CORPORATION & AFFILIATES. All rights reserved.
 * SPDX-License-Identifier: Apache-2.0
 */

var consts = require('../../consts.js');
var scheme = {
	$id: 'http://management/users/save.js',
	properties: {
		body: {
			type: 'array',
			items: {
				type: 'object',
				properties: {
					email: { type: 'string', format: 'email' },
					role: { 'enum': [consts.userRoles.OBSERVER, consts.userRoles.ADMIN] },
					notificationLevel: { 'enum': [consts.loggingLevel.NONE, consts.loggingLevel.WARNING, consts.loggingLevel.ERROR] },
					relogin: { type: 'boolean' },
					password: { type: 'string' },
					confirmationPassword: { type: 'string' }
				},
				required: ['password', 'confirmationPassword', 'email', 'role', 'notificationLevel']
			},
			minItems: 1
		}
	},
	required: ['body']
};

module.exports = scheme;
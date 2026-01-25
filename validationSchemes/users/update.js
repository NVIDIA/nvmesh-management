/*
 * SPDX-FileCopyrightText: Copyright (c) 2026 NVIDIA CORPORATION & AFFILIATES. All rights reserved.
 * SPDX-License-Identifier: Apache-2.0
 */

var consts = require('../../consts.js');
var scheme = {
	$id: 'http://management/users/update.js',
	properties: {
		body: {
			type: 'array',
			items: {
				type: 'object',
				properties: {
					_id: { type: 'string', format: 'email' },
					uuid: { $ref: consts.MANAGEMENT_DEFINITIONS + '/uuid.js' },
					role: { 'enum': [consts.userRoles.OBSERVER, consts.userRoles.ADMIN] },
					notificationLevel: { 'enum': [consts.loggingLevel.NONE, consts.loggingLevel.WARNING, consts.loggingLevel.ERROR] },
					relogin: { type: 'boolean' },
					resetPassword: { type: 'boolean' }
				},
				required: ['_id', 'uuid', 'role', 'notificationLevel']
			},
			minItems: 1
		}
	},
	required: ['body']
};

module.exports = scheme;
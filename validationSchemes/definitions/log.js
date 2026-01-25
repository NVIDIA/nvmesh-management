/*
 * SPDX-FileCopyrightText: Copyright (c) 2026 NVIDIA CORPORATION & AFFILIATES. All rights reserved.
 * SPDX-License-Identifier: Apache-2.0
 */

var consts = require('../../consts.js');
var scheme = {
	$id: consts.MANAGEMENT_DEFINITIONS + '/log.js',
	type: 'object',
	properties: {
		_id: { type: 'string' },
		timestamp: { type: 'string' },
		level: { enum: [consts.logsLevel.DEBUG, consts.logsLevel.ERROR, consts.logsLevel.INFO, consts.logsLevel.WARNING] },
		message: { type: 'string' },
		meta: {
			type: 'object',
			properties: {
				header: { type: 'string' },
				acknowledged: { type: 'boolean' },
				rawMessage: { type: 'string' },
				link: {
					type: 'object',
					properties: {
						entityType: { enum: [
							consts.entityType.CLIENT,
							consts.entityType.DISK,
							consts.entityType.NIC,
							consts.entityType.TARGET,
							consts.entityType.USER,
							consts.entityType.VOLUME
						] },
						entityText: { type: 'string' },
						target: { type: 'string' }
					}
				}
			},
			required: ['header', 'acknowledged', 'rawMessage', 'link']
		},
		acknowledgedBy: { type: 'string' },
		dateModified: { type: 'string' }
	},
	required: ['_id', 'timestamp', 'level', 'message', 'meta']
};

module.exports = scheme;
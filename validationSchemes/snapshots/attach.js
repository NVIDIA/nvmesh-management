/*
 * SPDX-FileCopyrightText: Copyright (c) 2026 NVIDIA CORPORATION & AFFILIATES. All rights reserved.
 * SPDX-License-Identifier: Apache-2.0
 */

var consts = require('../../consts.js');
var scheme = {
	$id: 'http://management/snapshots/attach.js',
	properties: {
		body: {
			type: 'object',
			properties: {
				snapshotID: { $ref: consts.MANAGEMENT_DEFINITIONS + '/volumeName.js' },
				clientID: { type: 'string' }
			},
			required: ['snapshotID', 'clientID']
		}
	},
	required: ['body']
};

module.exports = scheme;
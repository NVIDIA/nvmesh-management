/*
 * SPDX-FileCopyrightText: Copyright (c) 2026 NVIDIA CORPORATION & AFFILIATES. All rights reserved.
 * SPDX-License-Identifier: Apache-2.0
 */

const consts = require('../../consts.js');
const scheme = {
	$id: 'http://management/disks/formatdiskbyidsanduuids.js',
	properties: {
		body: {
			type: 'object',
			properties: {
				disks: {
					type: 'array',
					items: {
						type: 'object',
						properties: {
							_id: { $ref: consts.MANAGEMENT_DEFINITIONS + '/objectID.js#/properties/_id' },
							uuid: { $ref: consts.MANAGEMENT_DEFINITIONS + '/uuid.js' }
						},
						required: ['_id', 'uuid']
					},
					minItems: 1
				},
				formatType: { enum: [consts.formatTypes.FORMAT_EC, consts.formatTypes.FORMAT_RAID, null] }
			},
			required: ['disks']
		}
	},
	required: ['body']
};

module.exports = scheme;
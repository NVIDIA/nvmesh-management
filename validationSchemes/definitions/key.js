/*
 * SPDX-FileCopyrightText: Copyright (c) 2026 NVIDIA CORPORATION & AFFILIATES. All rights reserved.
 * SPDX-License-Identifier: Apache-2.0
 */

const consts = require('../../consts.js');
const scheme = {
	$id: consts.MANAGEMENT_DEFINITIONS + '/key.js',
	type: 'object',
	properties: {
		_id: { type: 'string', maxLength: 1024 },
		uuid: { $ref: consts.MANAGEMENT_DEFINITIONS + '/uuid.js' },
		description: { $ref: consts.MANAGEMENT_DEFINITIONS + '/description.js' }
	},
	required: ['_id', 'uuid']

};
module.exports = scheme;
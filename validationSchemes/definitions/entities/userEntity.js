/*
 * SPDX-FileCopyrightText: Copyright (c) 2026 NVIDIA CORPORATION & AFFILIATES. All rights reserved.
 * SPDX-License-Identifier: Apache-2.0
 */

var consts = require('../../../consts.js');
var userScheme = require('../user.js');
var utils = require('../../../utils.js');

var userEntityScheme = utils.extend(true, {}, userScheme);

userEntityScheme['$id'] = consts.MANAGEMENT_DEFINITIONS_ENTITIES + '/userEntity.js';
userEntityScheme['properties'] = {
	layout: {
		type: 'object',
		properties: {
			statistics: { type: 'object' }
		},
		required: ['statistics']
	}
};


var	redundantProperties = [
	'confirmationPassword',
	'password',
	'relogin'
];

userEntityScheme.required = userEntityScheme.required.filter((e) => redundantProperties.indexOf(e) === -1);

module.exports = userEntityScheme;

/*
 * SPDX-FileCopyrightText: Copyright (c) 2026 NVIDIA CORPORATION & AFFILIATES. All rights reserved.
 * SPDX-License-Identifier: Apache-2.0
 */

var consts = require('../../consts.js');

var scheme = {
	$id: consts.MANAGEMENT_DEFINITIONS + '/classesConstrains.js',
	allOf: [
		{ anyOf: [
			{ not: { required: ['limitByDisks'] } }, { properties: { limitByDisks: { anyOf: [{ maxItems: 0 }, { type: 'null' }] } } }
		] },
		{ anyOf: [
			{ not: { required: ['limitByNodes'] } }, { properties: { limitByNodes: { anyOf: [{ maxItems: 0 }, { type: 'null' }] } } }
		] },
		{ anyOf: [
			{ not: { required: ['VPG'] } }, { properties: { VPG: { maxLength: 0 } } }
		] },
	]
};
module.exports = scheme;
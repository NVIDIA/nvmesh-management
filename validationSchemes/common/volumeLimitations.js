/*
 * SPDX-FileCopyrightText: Copyright (c) 2026 NVIDIA CORPORATION & AFFILIATES. All rights reserved.
 * SPDX-License-Identifier: Apache-2.0
 */

const consts = require('../../consts.js');

const classesScheme = { type: 'array', items: { $ref: consts.MANAGEMENT_DEFINITIONS + '/className.js' } };
const limitByDisksScheme = { type: 'array', items: { $ref: consts.MANAGEMENT_DEFINITIONS + '/diskName.js' } };
const limitByNodesScheme = { type: 'array', items: { $ref: consts.MANAGEMENT_DEFINITIONS + '/targetName.js' } };
const limitationsDependencies = {
	diskClasses: {
		if: { properties: { diskClasses: { allOf: [{ minItems: 1 }, { not: { type: 'null' } }] } } },
		then: { $ref: consts.MANAGEMENT_DEFINITIONS + '/classesConstrains.js' }
	},
	serverClasses: {
		if: { properties: { serverClasses: { allOf: [{ minItems: 1 }, { not: { type: 'null' } }] } } },
		then: { $ref: consts.MANAGEMENT_DEFINITIONS + '/classesConstrains.js' }
	},
	limitByDisks: {
		if: { properties: { limitByDisks: { allOf: [{ minItems: 1 }, { not: { type: 'null' } }] } } },
		then: { $ref: consts.MANAGEMENT_DEFINITIONS + '/limitByConstrains.js' }
	},
	limitByNodes: {
		if: { properties: { limitByNodes: { allOf: [{ minItems: 1 }, { not: { type: 'null' } }] } } },
		then: { $ref: consts.MANAGEMENT_DEFINITIONS + '/limitByConstrains.js' }
	}
};

module.exports = { classesScheme, limitByDisksScheme, limitByNodesScheme, limitationsDependencies };
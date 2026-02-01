/*
 * SPDX-FileCopyrightText: Copyright (c) 2026 NVIDIA CORPORATION & AFFILIATES. All rights reserved.
 * SPDX-License-Identifier: Apache-2.0
 */

const utils = require('../../utils.js');
const upgradeStepScenarioSchema = require('../definitions/upgradeStepScenario.js');

const upgradeStepScenarioUpdateSchema = utils.extend(true, {}, upgradeStepScenarioSchema);
upgradeStepScenarioUpdateSchema.$id = 'http://management/upgradestepsscenarios/upgradeStepScenarioUpdate.js';
upgradeStepScenarioUpdateSchema.required = ['ID', 'name', 'command'];

const schema = {
	$id: 'http://management/upgradestepsscenarios/update.js',
	properties: {
		body: {
			type: 'array',
			items: upgradeStepScenarioUpdateSchema,
			minItems: 1
		}
	},
	required: ['body']
};

module.exports = schema;


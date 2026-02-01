/*
 * SPDX-FileCopyrightText: Copyright (c) 2026 NVIDIA CORPORATION & AFFILIATES. All rights reserved.
 * SPDX-License-Identifier: Apache-2.0
 */

const utils = require('../../utils.js');
const upgradeScenarioSchema = require('../definitions/upgradeScenario.js');

const upgradeScenarioUpdateSchema = utils.extend(true, {}, upgradeScenarioSchema);
upgradeScenarioUpdateSchema.$id = 'http://management/upgradescenarios/upgradeScenarioUpdate.js';
upgradeScenarioUpdateSchema.required = ['ID', 'upgradeTypeID', 'destinationReleaseID', 'sourceVersionID', 'steps'];

const schema = {
	$id: 'http://management/upgradescenarios/update.js',
	properties: {
		body: {
			type: 'array',
			items: upgradeScenarioUpdateSchema,
			minItems: 1
		}
	},
	required: ['body']
};

module.exports = schema;


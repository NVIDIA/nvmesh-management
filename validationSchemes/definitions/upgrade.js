/*
 * SPDX-FileCopyrightText: Copyright (c) 2026 NVIDIA CORPORATION & AFFILIATES. All rights reserved.
 * SPDX-License-Identifier: Apache-2.0
 */

const consts = require('../../consts');

const schema = {
	$id: 'http://management/definitions/upgrade.js',
	type: 'object',
	properties: {
		destinationVersion: { type: 'string' },
		executionMode: {
			type: 'string',
			enum: [consts.upgradeExecutionModes.AUTOMATIC, consts.upgradeExecutionModes.MANUAL_START],
			default: consts.upgradeExecutionModes.AUTOMATIC
		},
		minRedundancyLevel: {
			type: 'string',
			enum: Object.values(consts.upgradeRedundancyLevels),
			default: consts.upgradeRedundancyLevels.MAX
		},
		skipMachinesOnFailure: { type: 'boolean', default: false },
		maxErrorsThreshold: { type: 'number', minimum: 1, default: 1 },
		maxConcurrentClients: { type: 'number', minimum: 1, maximum: 100, default: 1 },
		machinesToUpgrade: {
			type: 'array',
			items: { $ref: consts.MANAGEMENT_DEFINITIONS + '/targetName.js' },
			minItems: 1
		}
	},
	additionalProperties: false,
	required: ['destinationVersion', 'machinesToUpgrade']
};

module.exports = schema;
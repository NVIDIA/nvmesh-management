/*
 * SPDX-FileCopyrightText: Copyright (c) 2026 NVIDIA CORPORATION & AFFILIATES. All rights reserved.
 * SPDX-License-Identifier: Apache-2.0
 */

const schema = {
	$id: 'http://management/definitions/upgradeStepScenario.js',
	type: 'object',
	properties: {
		ID: { type: 'integer' },
		name: { type: 'string', minLength: 1 },
		command: { type: 'string', minLength: 1 },
		timeout: { anyOf: [{ type: 'integer', minimum: 0 }, { type: 'null' }] },
		verificationCommand: { anyOf: [{ type: 'string' }, { type: 'null' }] },
		isVolumeAffected: { type: 'integer', enum: [0, 1] },
		arguments: { anyOf: [{ type: 'string', format: 'json' }, { type: 'null' }] }
	}
};

module.exports = schema;


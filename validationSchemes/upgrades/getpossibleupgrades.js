/*
 * SPDX-FileCopyrightText: Copyright (c) 2026 NVIDIA CORPORATION & AFFILIATES. All rights reserved.
 * SPDX-License-Identifier: Apache-2.0
 */

const schema = {
	$id: 'http://management/upgrades/getpossibleupgrades.js',
	type: 'object',
	properties: {
		query: {
			type: 'object',
			properties: {
				sourceVersion: { type: 'string' }
			}
		}
	}
};

module.exports = schema;
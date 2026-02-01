/*
 * SPDX-FileCopyrightText: Copyright (c) 2026 NVIDIA CORPORATION & AFFILIATES. All rights reserved.
 * SPDX-License-Identifier: Apache-2.0
 */

const consts = require('../../consts');

const scheme = {
	$id: consts.MANAGEMENT_DEFINITIONS + '/volumeEncryption.js',
	type: 'object',
	unevaluatedProperties: false,
	properties: {
		isInitialized: { type: 'boolean', default: false },
		headerSize: { type: 'integer', minimum: 1, maximum: 100, default: 16 }
	}
};

module.exports = scheme;
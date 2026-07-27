/*
 * SPDX-FileCopyrightText: Copyright (c) 2026 NVIDIA CORPORATION & AFFILIATES. All rights reserved.
 * SPDX-License-Identifier: Apache-2.0
 */

const consts = require('../../consts.js');

const schema = {
	$id: consts.MANAGEMENT_DEFINITIONS + '/artifactName.js',
	type: 'string',
	maxLength: 1024,
	minLength: 1,
	pattern: consts.artifactNameRegex.source,
};

module.exports = schema;
/*
 * SPDX-FileCopyrightText: Copyright (c) 2026 NVIDIA CORPORATION & AFFILIATES. All rights reserved.
 * SPDX-License-Identifier: Apache-2.0
 */

const consts = require('../../consts');
const utils = require('../../utils');
const volumeScheme = require('../definitions/volume');
const volumeCreateScheme = utils.extend(true, {}, volumeScheme);

volumeCreateScheme.$id = consts.MANAGEMENT_DEFINITIONS + '/volumeCreate.js';

const volumesCreateScheme = {
	$id: consts.MANAGEMENT_DEFINITIONS + '/volumesCreate.js',
	type: 'array',
	items: volumeCreateScheme,
	minItems: 1
};

module.exports = volumesCreateScheme;

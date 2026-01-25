/*
 * SPDX-FileCopyrightText: Copyright (c) 2026 NVIDIA CORPORATION & AFFILIATES. All rights reserved.
 * SPDX-License-Identifier: Apache-2.0
 */

var consts = require('../../../consts.js');
var volumeScheme = require('../volume.js');
var utils = require('../../../utils.js');

var volumeEntityScheme = utils.extend(true, {}, volumeScheme);

volumeEntityScheme['$id'] = consts.MANAGEMENT_DEFINITIONS_ENTITIES + '/volumeEntity.js';

module.exports = volumeEntityScheme;
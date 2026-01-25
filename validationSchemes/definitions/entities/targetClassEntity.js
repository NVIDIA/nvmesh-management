/*
 * SPDX-FileCopyrightText: Copyright (c) 2026 NVIDIA CORPORATION & AFFILIATES. All rights reserved.
 * SPDX-License-Identifier: Apache-2.0
 */

var consts = require('../../../consts.js');
var serverClassScheme = require('../serverClass.js');
var utils = require('../../../utils.js');

var targetClassEntityScheme = utils.extend(true, {}, serverClassScheme);

targetClassEntityScheme['$id'] = consts.MANAGEMENT_DEFINITIONS_ENTITIES + '/targetClassEntity.js';

module.exports = targetClassEntityScheme;
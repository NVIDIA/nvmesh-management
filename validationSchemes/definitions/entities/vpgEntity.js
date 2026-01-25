/*
 * SPDX-FileCopyrightText: Copyright (c) 2026 NVIDIA CORPORATION & AFFILIATES. All rights reserved.
 * SPDX-License-Identifier: Apache-2.0
 */

var consts = require('../../../consts.js');
var vpgScheme = require('../vpg.js');
var utils = require('../../../utils.js');

var vpgEntityScheme = utils.extend(true, {}, vpgScheme);

vpgEntityScheme['$id'] = consts.MANAGEMENT_DEFINITIONS_ENTITIES + '/vpgEntity.js';

module.exports = vpgEntityScheme;
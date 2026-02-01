/*
 * SPDX-FileCopyrightText: Copyright (c) 2026 NVIDIA CORPORATION & AFFILIATES. All rights reserved.
 * SPDX-License-Identifier: Apache-2.0
 */

var attachScheme = require('./attach.js');
var utils = require('../../utils.js');

var detachScheme = utils.extend(true, {}, attachScheme);
detachScheme['$id'] = detachScheme['$id'].replace('attach', 'detach');

module.exports = detachScheme;
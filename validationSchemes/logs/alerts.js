/*
 * SPDX-FileCopyrightText: Copyright (c) 2026 NVIDIA CORPORATION & AFFILIATES. All rights reserved.
 * SPDX-License-Identifier: Apache-2.0
 */

var scheme = require('./all.js');
var utils = require('../../utils.js');

scheme = utils.extend(true, {}, scheme);
scheme['$id'] = 'http://management/logs/alerts.js';

module.exports = scheme;
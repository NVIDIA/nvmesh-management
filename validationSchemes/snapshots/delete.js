/*
 * SPDX-FileCopyrightText: Copyright (c) 2026 NVIDIA CORPORATION & AFFILIATES. All rights reserved.
 * SPDX-License-Identifier: Apache-2.0
 */

var deleteVolumeScheme = require('../volumes/delete.js');
var utils = require('../../utils.js');

var deleteSnapshotScheme = utils.extend(true, {}, deleteVolumeScheme);
deleteSnapshotScheme['$id'] = deleteSnapshotScheme['$id'].replace('volumes', 'snapshots');

module.exports = deleteSnapshotScheme;
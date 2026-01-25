/*
 * SPDX-FileCopyrightText: Copyright (c) 2026 NVIDIA CORPORATION & AFFILIATES. All rights reserved.
 * SPDX-License-Identifier: Apache-2.0
 */

const consts = require('../../consts');
const utils = require('../../utils');
const volumeEncryptionScheme = require('./volumeEncryption');
const createVolumeEncryptionScheme = utils.extend(true, {}, volumeEncryptionScheme);

createVolumeEncryptionScheme.$id = consts.MANAGEMENT_DEFINITIONS + '/volumeCreateEncryption.js';
createVolumeEncryptionScheme.properties.isInitialized.const = false;

module.exports = createVolumeEncryptionScheme;


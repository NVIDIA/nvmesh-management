/*
 * SPDX-FileCopyrightText: Copyright (c) 2026 NVIDIA CORPORATION & AFFILIATES. All rights reserved.
 * SPDX-License-Identifier: Apache-2.0
 */

const consts = require('../../consts');

const scheme = {
	$id: consts.MANAGEMENT_DEFINITIONS + '/volumeMetadata.js',
	type: 'object',
	maxBytes: consts.MAX_METADATA_SIZE
};

module.exports = scheme;
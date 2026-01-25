/*
 * SPDX-FileCopyrightText: Copyright (c) 2026 NVIDIA CORPORATION & AFFILIATES. All rights reserved.
 * SPDX-License-Identifier: Apache-2.0
 */

const consts = require('../../consts.js');
const scheme = {
	$id: 'http://management/volumeprovisioninggroups/save.js',
	properties: { 
		body: { $ref: consts.MANAGEMENT_DEFINITIONS + '/vpgsCreate.js' }
	}
};

module.exports = scheme;
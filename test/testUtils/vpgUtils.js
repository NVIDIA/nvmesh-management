/*
 * SPDX-FileCopyrightText: Copyright (c) 2026 NVIDIA CORPORATION & AFFILIATES. All rights reserved.
 * SPDX-License-Identifier: Apache-2.0
 */

const consts = require('../../consts.js');
const VPGModule = require('../../modules/volumeProvisioningGroup.js');
const { Entities } = require('../../modules/error.js');

const VPG_USER = { email: consts.SYSTEM_USER };

exports.saveVPG = function(name, capacity, RAIDLevel, extraAttrs = {}) {
	return new Promise((resolve, reject) => {
		const vpg = { name, RAIDLevel, capacity, ...extraAttrs };
		VPGModule.saveVPGs([vpg], VPG_USER, logs => {
			const firstLog = Array.isArray(logs) ? logs[0] : null;
			const res = firstLog && firstLog.createApiResponse(Entities.VPG.ID, Entities.VPG.UUID);
			const error = (res && (res.err || res.error)) || new Error('saveVPGs returned no API response');
			if (!res || !res.success) return reject(error);
			resolve(res);
		});
	});
};

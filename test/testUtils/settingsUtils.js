/*
 * SPDX-FileCopyrightText: Copyright (c) 2026 NVIDIA CORPORATION & AFFILIATES. All rights reserved.
 * SPDX-License-Identifier: Apache-2.0
 */

/* global app */

const generalSettings = require('../../modules/generalSettings.js');

exports.setSettingsParam = function(param, value) {
	let settings = app.get('globalSettings');
	settings[param] = value;
	return new Promise((resolve, reject) => {
		generalSettings.updateGeneralSettings(settings, logs => {
			if (!logs[0].createApiResponse().success)
				return reject();

			resolve();
		});
	});
};

exports.setEnableZones = function(isEnabled) {
	return exports.setSettingsParam('enableZones', isEnabled);
};
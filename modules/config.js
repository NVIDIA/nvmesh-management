/*
 * SPDX-FileCopyrightText: Copyright (c) 2026 NVIDIA CORPORATION & AFFILIATES. All rights reserved.
 * SPDX-License-Identifier: Apache-2.0
 */

var userConfig = require('/etc/nvmesh/management.js.conf');
var defaultConfig = require('../management.js.conf');

var scope = {};

function getFromConfigRecursively(fieldName, conf) {
	var dotIndex = fieldName.indexOf('.');

	if (!conf)
		return conf;

	return dotIndex > -1
		? getFromConfigRecursively(fieldName.substring(dotIndex + 1), conf[fieldName.substring(0, dotIndex)])
		: conf[fieldName];
}

scope.get = function(fieldName) {
	var userConfigValue = getFromConfigRecursively(fieldName, userConfig);

	if (userConfigValue === undefined)
		return getFromConfigRecursively(fieldName, defaultConfig);

	return userConfigValue;
};

module.exports = scope;

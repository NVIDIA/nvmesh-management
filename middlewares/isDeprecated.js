/*
 * SPDX-FileCopyrightText: Copyright (c) 2026 NVIDIA CORPORATION & AFFILIATES. All rights reserved.
 * SPDX-License-Identifier: Apache-2.0
 */

const { deprecateApiResponses } = require('../utils');

const isDeprecated = (req, res, next) => {
	res.setHeader('Deprecation', true);

	const originalJson = res.json;
	res.json = (body) => originalJson.call(res, deprecateApiResponses(body));

	next();
};

module.exports = isDeprecated;

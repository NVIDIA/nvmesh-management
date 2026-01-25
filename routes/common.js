/*
 * SPDX-FileCopyrightText: Copyright (c) 2026 NVIDIA CORPORATION & AFFILIATES. All rights reserved.
 * SPDX-License-Identifier: Apache-2.0
 */

const { count, tryParseJSON } = require('../utils');

const scope = {};

scope.getCountEntitiesHandler = (entityType, requiredFilter = {}, defaultFilter = {}) => {
	return (req, res) => {
		const requestFilter = tryParseJSON(req.query.filter) || {};

		// requiredFilter overwrites (requestFilter overwrites defaultFilter)
		const filter = Object.assign({}, defaultFilter, requestFilter, requiredFilter);

		count(entityType, filter, (_, number) => res.json(number));
	};
};

module.exports = scope;

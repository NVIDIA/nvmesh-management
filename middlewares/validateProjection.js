/*
 * SPDX-FileCopyrightText: Copyright (c) 2026 NVIDIA CORPORATION & AFFILIATES. All rights reserved.
 * SPDX-License-Identifier: Apache-2.0
 */

const utils = require('../utils.js');
const {
	SystemMessage,
	Entities
} = require('../modules/error');
const systemMessages = require('../systemMessages');

const validateProjection = (req, res, next) => {
	const { projection } = req.query;

	const projectionObj = utils.tryParseJSON(projection);

	if (!projectionObj) {
		return next();
	}

	if (!isValidMongoProjection(projectionObj))
		return res.json(utils.createApiResponse(null, null, false, new SystemMessage(systemMessages.PROJECTION_VALIDATION)
			.addInfo(Entities.Mongo.projection, projectionObj)));

	next();
};

// Valid projection:
// 1. Values in the projection object should be either 1, 0, true, false, or an object representing a nested projection
// 2. Mixed inclusion (1 or true) and exclusion (0 or false) is not allowed, except for the _id field.
function isValidMongoProjection(projection) {
	const keys = Object.keys(projection);

	let hasInclusion = false;
	let hasExclusion = false;

	for (const key of keys) {
		const value = projection[key];

		if (typeof value === 'object' && value !== null && !Array.isArray(value)) {
			if (!isValidMongoProjection(value))
				return false;
		} else if (value === 1 || value === true) {
			hasInclusion = true;
		} else if (value === 0 || value === false) {
			hasExclusion = true;
		} else {
			return false;
		}

		if (key !== '_id' && hasInclusion && hasExclusion)
			return false;
	}

	return true;
}

module.exports = validateProjection;

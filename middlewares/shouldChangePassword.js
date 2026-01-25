/*
 * SPDX-FileCopyrightText: Copyright (c) 2026 NVIDIA CORPORATION & AFFILIATES. All rights reserved.
 * SPDX-License-Identifier: Apache-2.0
 */

const loginMiddleware = require('./login');
const utils = require('../utils');
const { SystemMessage } = require('../modules/error');
const systemMessages = require('../systemMessages');

// should be used only after isAuthenticated MW
const shouldChangePassword = (req, res, next) => {
	const isAcceptHTML = loginMiddleware.isAcceptHeaderSet(req) && loginMiddleware.getIsAcceptHTML(req);

	if (req.user.shouldChangePassword && req.originalUrl !== '/users/changePassword') {
		if (isAcceptHTML) {
			return res.redirect('/login/changePassword');
		}
		return res.json(utils.createApiResponse(null, null, false, new SystemMessage(systemMessages.CHANGING_PASSWORD_REQUIRED).toApiResponse()));
	}

	next();
};

module.exports = shouldChangePassword;

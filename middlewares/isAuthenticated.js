/*
 * SPDX-FileCopyrightText: Copyright (c) 2026 NVIDIA CORPORATION & AFFILIATES. All rights reserved.
 * SPDX-License-Identifier: Apache-2.0
 */

const consts = require('../consts');
const loginMiddleware = require('./login');
const config = require('../modules/config');
const logger = require('../logger');

/* global app */

const enforceAuthentication = (req, res, next) => {
	const httpsServerAuthenticationMethod = config.get('server.auth.authenticationMethod');

	switch (httpsServerAuthenticationMethod) {
		case consts.HTTPSServerAuthenticationMethods.CREDENTIALS: {
			let redirectUrl = '/login';
			req.session.messages = 'You need to login to view this page';

			// Pass the requested URL to redirect back here after login
			if (req.originalUrl !== '/')
				redirectUrl += `?redirectTo=${encodeURIComponent(req.originalUrl)}`;

			res.redirect(redirectUrl);
			break;
		}

		case consts.HTTPSServerAuthenticationMethods.MTLS:
			if (!loginMiddleware.isAcceptHeaderSet(req))
				return res.status(406).json({ error: '\'Accept\' header is not set' });

			loginMiddleware.login(req, res, loginMiddleware.getIsAcceptHTML(req), next);
			break;
	}
};

const reAuthenticate = (req, res, next, timeInactive) => {
	const email = req.user?.email;

	return loginMiddleware.logOutUser(req, function(err) {
		if (err)
			return loginMiddleware.sendLogoutErrorResponse(req, res, err);

		if (timeInactive)
			logger.sysDEBUG(`${email} logged out automatically after: ${timeInactive / 1000} seconds of inactivity.`);

		enforceAuthentication(req, res, next);
	});
};

const isAuthenticated = (req, res, next) => {
	const email = req.user?.email;
	const concurrentSessions = app.get('concurrentSessions');
	const concurrentSession = email in concurrentSessions && concurrentSessions[email][req.sessionID];

	if (!req.isAuthenticated() || !concurrentSession)
		return reAuthenticate(req, res, next);

	const now = new Date();
	const timeInactive = now - concurrentSession.lastActiveDate;
	const GLOBAL_SETTINGS = app.get('globalSettings');
	const isExpired = timeInactive > (GLOBAL_SETTINGS.autoLogOutThreshold || config.get('autoLogOutThreshold')) * 1000;

	//Check whether the user should be auto-disconnected for in-activity.
	if (isExpired)
		return reAuthenticate(req, res, next, timeInactive);

	concurrentSession.lastActiveDate = now;
	next();
};

module.exports = isAuthenticated;

/*
 * SPDX-FileCopyrightText: Copyright (c) 2026 NVIDIA CORPORATION & AFFILIATES. All rights reserved.
 * SPDX-License-Identifier: Apache-2.0
 */

/* global app */

const passport = require('passport');

const utils = require('../utils.js');
const consts = require('../consts.js');
const config = require('../modules/config.js');

const { Entities, SystemAdminMessage, SystemMessage } = require('../modules/error.js');
const systemMessages = require('../systemMessages.js');
const { createAuditRequestLog } = require('../modules/log');

const scope = {};

scope.isAcceptHeaderSet = req => req.headers.accept;

scope.getIsAcceptHTML = req => req.headers.accept.toLowerCase().includes('html');

function getRemoteIP(req) {
	const ip = req.ip;

	if (!ip)
		return;

	return ip.substr(0, 7) === '::ffff:' ? ip.substr(7) : ip;
}

scope.sendLogoutErrorResponse = (req, res, err) =>
	res
		.status(500)
		.json(new SystemMessage(systemMessages.LOGOUT_FAILED)
			.addInfo(Entities.User.email, req.user?.email)
			.addInfo(Entities.Error, err)
			.log()
			.createApiResponse(Entities.User.email));

scope.login = function(req, res, isAcceptHTML, next) {
	function sendResponse(redirectURL, result) {
		if (isAcceptHTML)
			return res.redirect(redirectURL);

		return result.success ? res.json(result) : res.status(401).json(result);
	}

	function success() {
		// Check if we should redirect after login
		const redirectTo = req.body.redirectTo ? decodeURIComponent(req.body.redirectTo) : null;
		const redirectURL = (redirectTo && redirectTo !== '/login') ? redirectTo : '/';
		return sendResponse(
			redirectURL,
			utils.createApiResponse(req.body.username, null, true, null, new SystemMessage(systemMessages.LOGIN_SUCCESS).toApiResponse())
		);
	}

	function error(err) {
		const usernameEncoded = encodeURIComponent(req.body.username);
		return sendResponse(`?err=true&username=${usernameEncoded}`, utils.createApiResponse(req.body.username, null, false, err));
	}

	function logFailedAttempt() {
		createAuditRequestLog(req, systemMessages.LOGIN_ATTEMPT_FAILED)
			.addInfo(Entities.User.email, req.body.username)
			.addInfo(Entities.module, Entities.modules.security)
			.log();
	}

	const authMethodToStrategy = {
		[consts.HTTPSServerAuthenticationMethods.CREDENTIALS]: consts.passportStrategies.LOCAL,
		[consts.HTTPSServerAuthenticationMethods.MTLS]: consts.passportStrategies.CLIENT_CERT
	};
	const httpsServerAuthenticationMethod = config.get('server.auth.authenticationMethod');
	const strategy = authMethodToStrategy[httpsServerAuthenticationMethod];

	const passportAuth = () => {
		passport.authenticate(strategy, function(err, user, info) {
			if (err) {
				new SystemAdminMessage(systemMessages.LOGIN_AUTHENTICATION_FAILED).addInfo(Entities.Error, err).log();
				return next(err);
			}

			if (!user) {
				if (info)
					req.session.messages = info.message;

				logFailedAttempt();
				return error(req.session.messages || 'You shall not pass!!');
			}

			req.logIn(user, function(err) {
				if (err) {
					req.session.messages = 'Error';

					logFailedAttempt();
					return next(err);
				}

				req.session.messages = 'Logged-in successfully';
				addSessionToConcurrentSessions(req);

				new SystemAdminMessage(systemMessages.LOGIN_SUCCESS)
					.addInfo(Entities.User.email, req.user.email).addInfo(Entities.module, Entities.modules.security).log();

				if (httpsServerAuthenticationMethod === consts.HTTPSServerAuthenticationMethods.MTLS && req.originalUrl !== '/login')
					return next();

				return success();
			});
		})(req, res, next);
	};

	if (httpsServerAuthenticationMethod === consts.HTTPSServerAuthenticationMethods.MTLS)
		return passportAuth();

	utils.getAuthenticationEmail(req.body.username, authenticationEmail => { req.body.username = authenticationEmail; passportAuth(); });
};

scope.logOutUser = function(req, cb) {
	if (req.user) {
		scope.removeSessionFromConcurrentSessions(req.user.email, req.sessionID);
		return req.logout(cb);
	}

	cb();
};

scope.logout = function(req, res, isAcceptHTML) {
	const msg = 'Logged-out successfully';

	if (req.isAuthenticated()){
		var user = req.user;

		scope.logOutUser(req, function(err) {
			if (err)
				return scope.sendLogoutErrorResponse(req, res, err);

			req.session.messages = msg;

			new SystemAdminMessage(systemMessages.LOGIN_LOGOUT_SUCCESS).addInfo(Entities.User.email, user.email).log();

			if (isAcceptHTML)
				res.redirect('/login');
			else
				res.json(utils.createApiResponse(user.email, null, true, null));
		});
	} else if (!isAcceptHTML) {
		scope.sendLogoutErrorResponse(req, res);
	}
};

scope.removeSessionFromConcurrentSessions = (email, sessionID) => {
	const concurrentSessions = app.get('concurrentSessions');
	const concurrentSession = email in concurrentSessions && concurrentSessions[email][sessionID];

	if (concurrentSession) {
		delete concurrentSessions[email][sessionID];

		if (!Object.keys(concurrentSessions[email]).length)
			delete concurrentSessions[email];
	}
};

scope.removeUsersSessionsFromConcurrentSessions = email => {
	const concurrentSessions = app.get('concurrentSessions');
	delete concurrentSessions[email];
};

function addSessionToConcurrentSessions(req) {
	const { user, sessionID } = req;
	const { email } = user;
	const remoteIp = getRemoteIP(req);
	const concurrentSessions = app.get('concurrentSessions');
	const concurrentSession = email in concurrentSessions && concurrentSessions[email][sessionID];

	if (concurrentSession)
		return;

	if (!remoteIp)
		return;

	const newconcurrentSession = { email, sessionID, remoteIp, lastActiveDate: new Date() };

	if (!(email in concurrentSessions))
		concurrentSessions[email] = {};

	concurrentSessions[email][sessionID] = newconcurrentSession;
}

function addMinutes(date, minutes) {
	return new Date(date.getTime() + minutes * 60000);
}

scope.getConcurrentSessions = (req) => {
	const concurrentSessions = app.get('concurrentSessions');
	const results = [];

	Object.values(concurrentSessions).forEach(concurrentSessionsByEmail => {
		Object.values(concurrentSessionsByEmail).forEach(concurrentSession => {
			if (concurrentSession.lastActiveDate > addMinutes(new Date(), -5)) {
				let concurrentSessionCloned;

				if (req.sessionID === concurrentSession.sessionID)
					concurrentSessionCloned = Object.assign({ me: true }, concurrentSession);

				results.push(concurrentSessionCloned || concurrentSession);
			}
		});
	});

	return results;
};

module.exports = scope;

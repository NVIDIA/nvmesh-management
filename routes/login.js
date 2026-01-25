/*
 * SPDX-FileCopyrightText: Copyright (c) 2026 NVIDIA CORPORATION & AFFILIATES. All rights reserved.
 * SPDX-License-Identifier: Apache-2.0
 */


/* global app */
var express = require('express');
const consts = require('../consts.js');
const config = require('../modules/config.js');
const utils = require('../utils.js');

var loginMiddleware = require('../middlewares/login.js');
const { SystemMessage } = require('../modules/error.js');
const systemMessages = require('../systemMessages.js');
const isAuthenticated = require('../middlewares/isAuthenticated');

var router = express.Router();
var isAcceptHTML;

router.use(function(req, res, next) {
	if (!loginMiddleware.isAcceptHeaderSet(req))
		return res.status(406).json({ error: '\'Accept\' header is not set' });

	isAcceptHTML = loginMiddleware.getIsAcceptHTML(req);
	next();
});

router.get('/', function(req, res, next) {
	if (req.user)
		return res.redirect('/');

	if (config.get('server.auth.authenticationMethod') === consts.HTTPSServerAuthenticationMethods.MTLS)
		loginMiddleware.login(req, res, isAcceptHTML, next);
	else if (isAcceptHTML)
		res.render('login', { message: req.session.messages, layout: false });
	else
		res.json(utils.createApiResponse(null, null, false, new SystemMessage(systemMessages.LOGIN_NOT_LOGGED_IN).toApiResponse()));

	req.session.messages = null;
});

router.get('/changePassword', function(req, res) {
	if (!req.user)
		return res.redirect('/login');

	if (!req.user.shouldChangePassword)
		return res.redirect('/');

	else if (isAcceptHTML)
		res.render('login', { message: req.session.messages, layout: false });
	else
		res.json(utils.createApiResponse(null, null, false, new SystemMessage(systemMessages.LOGIN_NOT_LOGGED_IN).toApiResponse()));

	req.session.messages = null;
});

/**
* @apiVersion 1.0.0
* @api {post} /login login
* @apiName login
* @apiGroup login
* @apiDescription Authentication method, on successful `login` responding with redirection to index page and a cookie.
* @apiParam {string} username The `username` to login.
* @apiParam {string} password The `password` to login.
*
* @apiParamExample {string} Payload example
* username=admin@nvidia.com&password=admin
*
* @apiSuccess {object} results success statuses
* @apiSuccessExample Example data on success
* [
*   {
*       "success": true,
*   	"uuid": "f02abf10-6bfb-11ed-a62f-d1b4ca08eefb",
*       "_id": "admin@nvidia.com",
*		"error": null,
*		"payload": null
*	}
* ]
*/
router.post('/', function(req, res, next) {
	loginMiddleware.login(req, res, isAcceptHTML, next);
});

/**
* @apiVersion 1.0.0
* @api {get} /login/logout logout
* @apiName logout
* @apiGroup login
* @apiDescription Logout the requesting user, on success via browser redirecting to `/login` page, on success via REST respond with the following json:
* {
*    "_id": "admin@nvidia.com",
*    "success": true,
*    "error": null
* }
*/
router.get('/logout', isAuthenticated, function(req, res) {
	loginMiddleware.logout(req, res, isAcceptHTML);
});

router.get('/inActivityThreshold', function(req, res) {
	var GLOBAL_SETTINGS = app.get('globalSettings');
	res.json(GLOBAL_SETTINGS.autoLogOutThreshold * 1000);
});

module.exports = router;

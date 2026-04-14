/*
 * SPDX-FileCopyrightText: Copyright (c) 2026 NVIDIA CORPORATION & AFFILIATES. All rights reserved.
 * SPDX-License-Identifier: Apache-2.0
 */

var express = require('express');
var consts = require('../consts.js');
var router = express.Router();

router.get('/cdv', function(req, res) {
	var renderData = {};
	if (req.headers['x-pjax'])
		renderData.layout = false;
	renderData.user = { email: req.user.email, isAdmin: req.user.role === consts.userRoles.ADMIN };
	renderData.componentName = consts.componentsPages.cdv;
	res.render('react', renderData);
});

router.get('/tpv', function(req, res) {
	var renderData = {};
	if (req.headers['x-pjax'])
		renderData.layout = false;
	renderData.user = { email: req.user.email, isAdmin: req.user.role === consts.userRoles.ADMIN };
	renderData.componentName = consts.componentsPages.tpv;
	res.render('react', renderData);
});

module.exports = router;

/*
 * SPDX-FileCopyrightText: Copyright (c) 2026 NVIDIA CORPORATION & AFFILIATES. All rights reserved.
 * SPDX-License-Identifier: Apache-2.0
 */


/* global */

var express = require('express');

var consts = require('../consts.js');

var router = express.Router();

router.get('/', function(req, res) {
	var renderData = {};
	if (req.headers['x-pjax'])
		renderData.layout = false;

	renderData.user = { email: req.user.email, isAdmin: req.user.role === consts.userRoles.ADMIN };
	renderData.isReact = true;
	renderData.componentName = consts.componentsPages.cluster;
	if (consts.userRoles.ADMIN === req.user.role)
		res.render('react', renderData);
	else
		res.send('insufficient privileges');
});

module.exports = router;

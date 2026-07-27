/***************************************************************************
 * Copyright (C) 2015-2020 Excelero, Inc. All Rights Reserved.
 *
 * This file is part of Excelero NVMesh software.
 *
 * Unauthorized copying of this file, via any medium is strictly prohibited
 * Proprietary and confidential
 ****************************************************************************/

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

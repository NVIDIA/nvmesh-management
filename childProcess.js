/***************************************************************************
 * Copyright (C) 2015-2020 Excelero, Inc. All Rights Reserved.
 *
 * This file is part of Excelero NVMesh software.
 *
 * Unauthorized copying of this file, via any medium is strictly prohibited
 * Proprietary and confidential
 ****************************************************************************/

var cluster = require('cluster');

var scope = module.exports;

scope.fork = function(filePathRelativeToRoot){
	cluster.setupMaster({
		exec: __dirname + filePathRelativeToRoot
	});

	return cluster.fork();
};
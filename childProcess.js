/*
 * SPDX-FileCopyrightText: Copyright (c) 2026 NVIDIA CORPORATION & AFFILIATES. All rights reserved.
 * SPDX-License-Identifier: Apache-2.0
 */

var cluster = require('cluster');

var scope = module.exports;

scope.fork = function(filePathRelativeToRoot){
	cluster.setupMaster({
		exec: __dirname + filePathRelativeToRoot
	});

	return cluster.fork();
};

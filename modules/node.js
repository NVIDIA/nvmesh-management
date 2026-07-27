
/***************************************************************************
 * Copyright (C) 2015-2020 Excelero, Inc. All Rights Reserved.
 *
 * This file is part of Excelero NVMesh software.
 *
 * Unauthorized copying of this file, via any medium is strictly prohibited
 * Proprietary and confidential
 ****************************************************************************/

var async = require('async');

var utils = require('../utils.js');
var events = require('../events.js');
var objectNotifier = require('../objectNotifier.js');
var { MongoError } = require('./error.js');

var scope = {};

scope.checkIfNodeRemove = function(nodeID) {
	async.parallel({
		target: function(cb) {
			utils.loadCollection('server', { filter: { _id: nodeID } }, cb);
		},
		client: function(cb) {
			utils.loadCollection('client', { filter: { clientID: nodeID } }, cb);
		},
	}, function(err, checkResults) {
		if (err)
			new MongoError(err).log();

		if (!checkResults.target.length && !checkResults.client.length)
			events.emitEvent([events.getNodeID(nodeID)], objectNotifier.events.nodeRemovedEvent, { nodeID: nodeID });
	});
};

module.exports = scope;
/***************************************************************************
 * Copyright (C) 2015-2020 Excelero, Inc. All Rights Reserved.
 *
 * This file is part of Excelero NVMesh software.
 *
 * Unauthorized copying of this file, via any medium is strictly prohibited
 * Proprietary and confidential
 ****************************************************************************/

/* global app */

const uuid = require('uuid');

const systemMessages = require('../systemMessages.js');
const { MongoError, SystemAdminMessage, Entities } = require('./error.js');

const scope = {};

scope.getClusterID = (cb) => {
	const nvmeshMetadataDB = app.get('nvmeshMetadataDB');
	const clusterCollection = nvmeshMetadataDB.collection('cluster');

	clusterCollection.findOne({}, (err, clusterID) => {
		if (err)
			new MongoError(err).log();

		cb(clusterID);
	});
};

scope.updateClusterID = (clusterID, cb) => {
	const nvmeshMetadataDB = app.get('nvmeshMetadataDB');
	const clusterCollection = nvmeshMetadataDB.collection('cluster');
	const newClusterID = { id: clusterID, needReconfirm: false };

	const onError = e => done(new SystemAdminMessage(systemMessages.UPDATE_CLUSTER_ID_FAILED).addInfo(Entities.Error, e));
	const onSuccess = () => done(new SystemAdminMessage(systemMessages.CLUSTER_ID_UPDATED));
	const done = l => cb([l.addInfo(Entities.ManagementCluster.ID, clusterID)]);

	clusterCollection.updateOne({}, { $set: newClusterID }, { upsert: true }, (err, results) => {
		if (err)
			return onError(new MongoError(err).log());

		if (results?.upsertedCount)
			return clusterCollection.updateOne({}, { $set: { uuid: uuid.v1() } }, (err) => {
				if (err)
					return onError(new MongoError(err).log());

				onSuccess();
			});

		onSuccess();
	});
};

module.exports = scope;
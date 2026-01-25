/*
 * SPDX-FileCopyrightText: Copyright (c) 2026 NVIDIA CORPORATION & AFFILIATES. All rights reserved.
 * SPDX-License-Identifier: Apache-2.0
 */

/* global app */
const { createSnapshot } = require('../../modules/volume');
const { VolumeRAID10 } = require('./volume');
const consts = require('../../consts');
const { Entities } = require('../../modules/error');
const volumeModule = require('../../modules/volume');

const user = { email: consts.ADMIN_USER };

class Snapshot extends VolumeRAID10 {
	constructor(name, sourceID, params) {
		super();
		this._id = name;
		this.name = name;
		this.sourceID = sourceID;
		this.sourceUUID;

		if (params)
			for (let key in params) {
				this[key] = params[key];
			}

		// omit capacity to inherit capacity from source by default
		delete this.capacity;
	}

	save() {
		let self = this;
		return new Promise((resolve, reject) => {
			app.get('db').collection('volume').findOne({ _id: this.sourceID }, { uuid: 1 }, (err, source) => {
				if (err) return reject(err);

				this.sourceUUID = source?.uuid;
				let snapshotObj = self.preSave();
				createSnapshot(snapshotObj, user, (log) => {
					const result = log.createApiResponse(Entities.Volume.ID, Entities.Volume.UUID);
					app.get('db').collection('volume').findOne({ _id: this._id }, { uuid: 1 }, (err, snapshot) => {
						if (err) return reject(err);
						this.uuid = snapshot?.uuid;
						this.metadataVolumeID = snapshot?.metadataVolumeID;
						this.metadataVolumeUUID = snapshot?.metadataVolumeUUID;
						resolve(result);
					});
				});
			});
		});
	}

	remove() {
		let self = this;
		return new Promise((resolve, reject) => {
			app.get('db').collection('volume').findOne({ _id: this._id }, { uuid: 1 }, (err, vol) => {
				if (err) return reject(err);

				this.uuid = vol.uuid;

				volumeModule.deleteSnapshot(self, (message) => {
					const response = message.createApiResponse(Entities.Volume.ID, Entities.Volume.UUID);
					if (response.error)
						reject(response.error);
					else
						resolve();
				});
			});
		});
	}
}

exports.Snapshot = Snapshot;

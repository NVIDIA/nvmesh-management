/*
 * SPDX-FileCopyrightText: Copyright (c) 2026 NVIDIA CORPORATION & AFFILIATES. All rights reserved.
 * SPDX-License-Identifier: Apache-2.0
 */

const { Entities } = require('../../modules/error');
const { saveVSGs, updateVSGs, deleteVSGs } = require('../../modules/volumeSecurityGroup');
const { Entity } = require('./entity');


const user = { email: 'admin@acme.com' };

exports.VolumeSecurityGroup = class VolumeSecurityGroup extends Entity {
	constructor(name, keys) {
		super();
		this._id = name;
		this.keys = keys || [];
	}

	save() {
		let self = this;
		return new Promise(resolve => {
			let vsg = self.preSave();
			saveVSGs([vsg], user, logs => {
				const results = logs.map(l => l.createApiResponse(Entities.VSG.ID, Entities.VSG.UUID));
				this.uuid = results[0].uuid;
				resolve(results[0]);
			});
		});
	}


	update() {
		let self = this;
		return new Promise(resolve => {
			let vsg = self.preSave();
			updateVSGs([vsg], user, logs => {
				const results = logs.map(l => l.createApiResponse(Entities.VSG.ID, Entities.VSG.UUID));
				resolve(results[0]);
			});
		});
	}	
	
	addKey(keyName) {
		this.keys.push(keyName);
		return this;
	}

	delete() {
		let self = this;
		return new Promise(resolve => {
			deleteVSGs([{ _id: self._id, uuid: self.uuid }], logs => {
				const results = logs.map(l => l.createApiResponse(Entities.VSG.ID, Entities.VSG.UUID));
				resolve(results[0]);
			});
		});
	}

	removeKey(keyName) {
		let index = this.keys.indexOf(keyName);
		if (index == -1) 
			throw new Error('Key not in VSG keys');

		this.keys.splice(index, 1);
		return this;
	}
};

/*
 * SPDX-FileCopyrightText: Copyright (c) 2026 NVIDIA CORPORATION & AFFILIATES. All rights reserved.
 * SPDX-License-Identifier: Apache-2.0
 */

/* global */
var diskClassModule = require('../../modules/diskClass.js');
const { Entity } = require('./entity.js');
const consts = require('../../consts');
const { Entities } = require('../../modules/error.js');

exports.DiskClassEntry = class DiskClassEntry {
	constructor(diskID, nodeID, model) {
		this.diskID = diskID;
		this.node_id = nodeID;
		this.model = model;
	}
};

exports.DiskClass = class DiskClass extends Entity {
	constructor(name, disks) {
		super();
		this._id = name;
		this.tags = [];
		this.disks = disks;
		this.domains = [];
	}

	save() {
		return new Promise((resolve, reject) => {
			let diskClassObj = this.preSave();
			let user = { email: consts.ADMIN_USER };
			diskClassModule.saveDriveClasses([diskClassObj], user, (logs) => {
				const result = logs[0].createApiResponse(Entities.DriveClass.ID, Entities.DriveClass.UUID);

				if (result.error)
					return reject(result.error);

				this.uuid = result.uuid;
				resolve(result);
			});
		});
	}

	update() {
		return new Promise((resolve, reject) => {
			let diskClassObj = this.preSave();
			let user = { email: consts.ADMIN_USER };
			diskClassModule.updateDriveClasses([diskClassObj], user, (logs) => {
				const result = logs[0].createApiResponse(Entities.DriveClass.ID, Entities.DriveClass.UUID);

				if (result.error)
					return reject(result.error);

				resolve(result);
			});
		});
	}
};

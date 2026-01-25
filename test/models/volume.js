/*
 * SPDX-FileCopyrightText: Copyright (c) 2026 NVIDIA CORPORATION & AFFILIATES. All rights reserved.
 * SPDX-License-Identifier: Apache-2.0
 */

const consts = require('../../consts');
const { Entities } = require('../../modules/error');
const { markVolumesForDeletion, saveVolumes } = require('../../modules/volume');
const { updateVolume, extendVolume } = require('../../utils');

const { Entity } = require('./entity');

const defaultUserEmail = consts.ADMIN_USER;
const user = { email: defaultUserEmail };

class Volume extends Entity {
	constructor(name, raidType) {
		super();
		this._id = name;
		this.name = name;
		this.RAIDLevel = raidType;
		this.capacity = 1;
		this.limitByNodes = [];
		this.limitByDisks = [];
		this.serverClasses = [];
		this.diskClasses = [];
		this.relativeRebuildPriority = 10;
		this.enableNVMf = false;
		this.enableCrcCheck = false;
		this.selectedClientsForNvmf = [];
		this.createdBy = defaultUserEmail;
		this.modifiedBy = defaultUserEmail;
		this.dateCreated = new Date();
		this.dateModified = new Date();
		this.version = 1;
		this.isReserved = false;
		this.chunks = [];
	}

	save() {
		let volumeJson = this.preSave();
		return new Promise(resolve => {
			saveVolumes([volumeJson], user, logs => {
				this.uuid = logs[0].getAdditionalInfoByKey(Entities.Volume.UUID);
				resolve(logs[0].createApiResponse(Entities.Volume.ID, Entities.Volume.UUID));
			});
		});
	}

	createOrReject() {
		return this.save()
			.then(result => {
				if (result.success) {
					this.uuid = result.uuid;
					return;
				}
				throw new Error(`Failed to create volume ${this._id}. Error: ${JSON.stringify(result.err || result.error)}`);
			});
	}

	markForDeletion() {
		// mever rejects because markVolumesForDeletion() never returns an error
		return new Promise(resolve => {
			markVolumesForDeletion([{ _id: this._id, uuid: this.uuid }], logs => {
				resolve(logs[0].createApiResponse());
			});
		});
	}

	update(updateObj) {
		// mever rejects because markVolumesForDeletion() never returns an error
		return new Promise(resolve => {
			if (!updateObj)
				updateObj = this.preSave();
			updateVolume(updateObj, user, message => {
				resolve(message);
			});
		});
	}

	extend(updateObj) {
		return new Promise(resolve => {
			if (!updateObj)
				updateObj = this.preSave();
			extendVolume(updateObj, user, message => {
				resolve(message.createApiResponse(Entities.Volume.ID, Entities.Volume.UUID));
			});
		});
	}
}

class VolumeConcatenated extends Volume {
	constructor(name) {
		super(name, consts.RAIDLevel.CONCATENATED);
	}
}

class VolumeRAID1 extends Volume {
	constructor(name) {
		super(name, consts.RAIDLevel.MIRRORED_RAID_1);
		this.numberOfMirrors = 1;
	}
}

class VolumeRAID0 extends Volume {
	constructor(name) {
		super(name, consts.RAIDLevel.STRIPED_RAID_0);
		this.stripeSize = 32;
		this.stripeWidth = 2;
	}
}

class VolumeRAID10 extends VolumeRAID0 {
	constructor(name) {
		super(name);
		this.RAIDLevel = consts.RAIDLevel.STRIPED_AND_MIRRORED_RAID_10;
		this.numberOfMirrors = 1;
	}
}

class VolumeEC extends VolumeRAID0 {
	constructor(name) {
		super(name, consts.RAIDLevel.ERASURE_CODING);
		this.RAIDLevel = consts.RAIDLevel.ERASURE_CODING;
		this.stripeWidth = 1;
		this.parityBlocks = 2;
		this.dataBlocks = 8;
		this.protectionLevel = consts.ecSeparationTypes.FULL;
	}
}

class VolumeStripedEC extends VolumeRAID0 {
	constructor(name) {
		super(name, consts.RAIDLevel.STRIPED_ERASURE_CODING);
		this.RAIDLevel = consts.RAIDLevel.STRIPED_ERASURE_CODING;
		this.stripeWidth = 2;
		this.parityBlocks = 2;
		this.dataBlocks = 8;
		this.protectionLevel = consts.ecSeparationTypes.FULL;
	}
}

exports.Volume = Volume;
exports.VolumeRAID0 = VolumeRAID0;
exports.VolumeRAID1 = VolumeRAID1;
exports.VolumeRAID10 = VolumeRAID10;
exports.VolumeConcatenated = VolumeConcatenated;
exports.VolumeEC = VolumeEC;
exports.VolumeStripedEC = VolumeStripedEC;

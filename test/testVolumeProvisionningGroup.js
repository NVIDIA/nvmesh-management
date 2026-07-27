/* global app, describe, before, after, it */

const consts = require('../consts');
const dbManager = require('./testUtils/dbManager');
const { generateTargets } = require('./testUtils/entityGenerators');
const { assertIsCausedBy } = require('./testUtils/errorUtils.js');
const assert = require('assert');
const { setup } = require('./testUtils/setup');
const VPGModule = require('../modules/volumeProvisioningGroup');
const utils = require('../utils');
const systemMessages = require('../systemMessages');
const { Entities } = require('../modules/error.js');

const FIFTY_GB = 50;
const USER = { email: consts.SYSTEM_USER };
let vpgCollection, volumeCollection;


function generateAndSaveTargets(count, numOfDisks) {
	let targets = generateTargets(count, '1', numOfDisks);
	return Promise.all(targets.map(t => t.save()));
}

class TestableVPG {
	constructor(capacity, RAIDLevel) {
		this.uuid;
		this.capacity = capacity;
		this.RAIDLevel = RAIDLevel;
		this.name = this.generateVPGName(this.capacity, this.RAIDLevel);
		this._id = this.name;
		this.testName = `VPG ${this.RAIDLevel} ${this.capacity}GB`;
		this.volumeOnVPG = 0;
		this.deleted = false;
	}

	generateVPGName() { }
	generateVolumeName() { return `${this.name}_${this.volumeOnVPG}`; }
	addAttributesToVPGPayload() { }

	save() {
		return new Promise((resolve, reject) => {
			const VPG = {
				RAIDLevel: this.RAIDLevel,
				capacity: this.capacity,
				allowOverflow: true,
				name: this.name,
			};
			this.addAttributesToVPGPayload(VPG);

			VPGModule.saveVPGs([VPG], USER, logs => {
				const responses = logs.map(l => l.createApiResponse(Entities.VPG.ID, Entities.VPG.UUID));
				if (responses[0].error)
					return reject(responses[0].error);

				this._id = responses[0]._id;
				this.uuid = responses[0].uuid;

				resolve();
			});
		});
	}

	editDescription() {
		return new Promise((resolve, reject) => {
			const VPG = {
				_id: this._id,
				uuid: this.uuid,
				description: 'New Description'
			};

			VPGModule.updateVPGs([VPG], USER, logs => {
				const responses = logs.map(l => l.createApiResponse(Entities.VPG.ID, Entities.VPG.UUID));
				if (responses[0].error)
					return reject(responses[0].error);

				this.description = VPG.description;

				resolve();
			});
		});
	}

	extend(newCapacity, allowFailure) {
		return new Promise((resolve, reject) => {
			const VPG = {
				_id: this._id,
				uuid: this.uuid,
				capacity: newCapacity
			};

			VPGModule.extendVPGs([VPG], USER, logs => {
				const responses = logs.map(l => l.createApiResponse(Entities.VPG.ID, Entities.VPG.UUID));
				if (responses[0].error && !allowFailure)
					return reject(responses[0].error);

				if (!responses[0].error)
					this.capacity = newCapacity;

				resolve(responses[0]);
			});
		});
	}

	delete(shouldFail) {
		return new Promise((resolve, reject) => {
			const VPG = {
				_id: this._id,
				uuid: this.uuid
			};

			VPGModule.deleteVPGs([VPG], logs => {
				const responses = logs.map(l => l.createApiResponse(Entities.VPG.ID, Entities.VPG.UUID));
				if (shouldFail) {
					if (!responses[0].error)
						return reject('Delete VPG should have failed');
					else
						return resolve();

				} else {
					if (responses[0].error)
						return reject(responses[0].error);

					this.deleted = true;

					resolve();
				}
			});
		});
	}

	saveVolumeOnVPG(vpgCapacityFactor) {
		const volumeCapacity = this.capacity ? this.capacity * vpgCapacityFactor : FIFTY_GB;
		const volumeName = this.generateVolumeName();

		return new Promise((resolve, reject) => {
			const volume = {
				_id: volumeName,
				name: volumeName,
				capacity: volumeCapacity,
				RAIDLevel: this.RAIDLevel,
				VPG: this.name
			};

			this.addAttributesToVPGPayload(volume);

			utils.createVolumes([volume], USER, logs => {
				const responses = logs.map(l => l.createApiResponse(Entities.VPG.ID, Entities.VPG.UUID));
				if (responses[0].error)
					return reject(responses[0].error);

				this.volumeOnVPG++;

				resolve();
			});
		});
	}

	deleteVolumesOnVPG() {
		return new Promise((resolve, reject) => {
			const volumes = [];

			while (this.volumeOnVPG !== 0) {
				this.volumeOnVPG--;
				volumes.push(this.generateVolumeName());
			}

			if (!volumes.length)
				return resolve();

			volumeCollection.find({ _id: { $in: volumes } }).project({ _id: 1, uuid: 1 }).toArray((err, volumesToDeletePayload) => {
				if (err)
					return reject(err);

				// using force delete as delete is not working on volume with initializing status
				utils.forceDeleteVolumes(volumesToDeletePayload, null, false, (err, responses) => {
					if (err)
						return reject(err);

					if (responses.some(response => !response.success))
						return reject(`Failed to delete volumes on VPG, responses: ${JSON.stringify(responses)}`);

					this.volumeOnVPG = 0;

					resolve();
				});

			});

		});
	}

	sanityTest() {
		return new Promise((resolve, reject) => {
			if (!this.deleted) {
				vpgCollection.findOne({
					_id: this._id,
					uuid: this.uuid,
					capacity: this.capacity,
					RAIDLevel: this.RAIDLevel,
					description: this.description
				}, (err, vpgFromDb) => {
					if (err)
						return reject(err);

					if (!vpgFromDb)
						return reject(`Sanity Error: Unable to find vpg with attributes:
							${[this._id, this.uuid, this.capacity, this.RAIDLevel, this.description]}`);

					if (!this.capacity)
						return resolve();

					volumeCollection.findOne({
						_id: this._id,
						uuid: this.uuid,
						capacity: this.capacity,
						RAIDLevel: this.RAIDLevel
					}, (err, volumeFromDb) => {
						if (err)
							return reject(err);

						if (!volumeFromDb)
							return reject(
								`Sanity Error: Unable to find volume with attributes:
										${[this._id, this.uuid, this.capacity, this.RAIDLevel]}`);

						return resolve();
					});
				});
			}

			resolve();
		});
	}
}

class TestableConcatenatedVPG extends TestableVPG {
	constructor(capacity) {
		super(capacity, consts.RAIDLevel.CONCATENATED);
	}

	generateVPGName() { return `c${this.capacity ? '_reserved' : ''}`; }
}

class TestableRAID0VPG extends TestableVPG {
	constructor(capacity) {
		super(capacity, consts.RAIDLevel.STRIPED_RAID_0);
	}

	generateVPGName() { return `r0${this.capacity ? '_reserved' : ''}`; }

	addAttributesToVPGPayload(volume) {
		volume.stripeSize = 32;
		volume.stripeWidth = 2;
	}
}

class TestableRAID1VPG extends TestableVPG {
	constructor(capacity) {
		super(capacity, consts.RAIDLevel.MIRRORED_RAID_1);
	}

	generateVPGName() { return `r1${this.capacity ? '_reserved' : ''}`; }

	addAttributesToVPGPayload(volume) {
		volume.numberOfMirrors = 1;
	}
}

class TestableRAID10VPG extends TestableVPG {
	constructor(capacity) {
		super(capacity, consts.RAIDLevel.STRIPED_AND_MIRRORED_RAID_10);
	}

	generateVPGName() { return `r10${this.capacity ? '_reserved' : ''}`; }

	addAttributesToVPGPayload(VPG) {
		VPG.stripeSize = 32;
		VPG.stripeWidth = 2;
		VPG.numberOfMirrors = 1;
	}
}

class TestableECVPG extends TestableVPG {
	constructor(capacity) {
		super(capacity, consts.RAIDLevel.ERASURE_CODING);
	}

	generateVPGName() { return `ec${this.capacity ? '_reserved' : ''}`; }

	addAttributesToVPGPayload(VPG) {
		VPG.dataBlocks = 8;
		VPG.parityBlocks = 2;
		VPG.stripeWidth = 1;
		VPG.stripeSize = 32;
		VPG.enableCrcCheck = true;
		VPG.protectionLevel = consts.ecSeparationTypes.FULL;
	}
}

function getTestableVPGsByCapacity(capacity) {
	const testableVPGs = [];

	testableVPGs.push(new TestableConcatenatedVPG(capacity));
	testableVPGs.push(new TestableRAID0VPG(capacity));
	testableVPGs.push(new TestableRAID1VPG(capacity));
	testableVPGs.push(new TestableRAID10VPG(capacity));
	testableVPGs.push(new TestableECVPG(capacity));

	return testableVPGs;
}

function testVPGSuite(reservedSpace) {
	const capacity = reservedSpace ? FIFTY_GB : 0;
	const testableVPGs = getTestableVPGsByCapacity(capacity);

	testableVPGs.forEach(testableVPG => {
		before(() => setup.newSetup().then(() => generateAndSaveTargets(10, 8)));

		testVPG(testableVPG);
	});
}

function testVPG(testableVPG) {
	describe(testableVPG.testName, () => {
		after(() => testableVPG.sanityTest());

		it('Save', () => testableVPG.save());
		it('Edit Description', () => testableVPG.editDescription());

		if (testableVPG.capacity) {
			it('Extend', () => testableVPG.extend(2 * FIFTY_GB));
			it('Save Volume In Reserved Space', () => testableVPG.saveVolumeOnVPG(0.5));
		}

		it('SecondExtend', () => testableVPG.extend(3 * FIFTY_GB));
		it('Save Volume Out Of Reserved Space', () => testableVPG.saveVolumeOnVPG(1));
		it('Delete (should fail)', () => testableVPG.delete(true));
		it('Delete Volumes', () => testableVPG.deleteVolumesOnVPG());
		it('Delete', () => testableVPG.delete());
	});
}

function testRaceConditions() {
	describe('Race Between Extend VPGs - starting from reserved space', testExtendFromReservedSpaceVPGRace);
	describe('Race Between Extend VPGs - starting not from reserved space', testExtendNotFromReservedSpaceVPGRace);

}

function testExtendFromReservedSpaceVPGRace() {
	/*
	*	Flow Description:
	*	VPG exists with 1GB reserved space
	* 	2 users are extending the same VPG at the same time - each user is extending via a different management in the same cluster
	*	the first extend VPG processed will extend to 4GB but get stuck after the extendVolume flow
	* 	the second extend VPG processed will extend to 2GB and succeed
	*	the first extend VPG finished to be stuck and finish to update the VPG accordingly - NVMESH-2252
	* 	the result is that the VPG document is updated to capacity === 2GB, while it is actually 4GB
	*
	*	The solution was to complete the VPG extension only if the VPG capacity did not change and to validate
	* 	the extendVolume finished successfully in order to modify the VPG document
	*/
	const originalExtendVolumes = utils.extendVolumes;
	const VPG = new TestableConcatenatedVPG(FIFTY_GB);

	before(() => setup.newSetup().then(() => generateAndSaveTargets(3, 2)));

	it('Save', () => VPG.save());
	it('Extend', () => {
		let p1, p2;
		let firstTimeCallingExtendVolume = true;

		utils.extendVolumes = (volumes, user, cb) => {
			originalExtendVolumes(volumes, user, (responses, logs) => {
				if (firstTimeCallingExtendVolume) {
					firstTimeCallingExtendVolume = false;
					p2 = VPG.extend(2 * FIFTY_GB, true);
					setTimeout(() => cb(responses, logs), 1000);
				} else {
					firstTimeCallingExtendVolume = false;
					cb(responses, logs);
				}
			});
		};

		p1 = VPG.extend(3 * FIFTY_GB, true);

		return p1
			.then(response => {
				assert(!response.error);
				return p2;
			})
			.then(response => assertIsCausedBy(response.error, systemMessages.VPG_EXTEND_FAILED))
			.then(() => vpgCollection.findOne({ _id: VPG._id }, { capacity: 1 }))
			.then(vpgFromDB => volumeCollection.findOne({ _id: VPG._id, capacity: vpgFromDB.capacity }, { _id: 0 }))
			.then(volumeFromDB => assert(volumeFromDB, 'error: volume from DB capacity !== VPG from DB capacity'))
			.finally(() => utils.extendVolumes = originalExtendVolumes);
	});
}

function testExtendNotFromReservedSpaceVPGRace() {
	/*
	*	Flow Description:
	*	VPG exists with 1GB reserved space
	* 	2 users are extending the same VPG at the same time - each user is extending via a different management in the same cluster
	*	the first extend VPG processed will extend to 4GB but get stuck after the extendVolume flow
	* 	the second extend VPG processed will extend to 2GB and succeed
	*	the first extend VPG finished to be stuck and finish to update the VPG accordingly - NVMESH-2252
	* 	the result is that the VPG document is updated to capacity === 2GB, while it is actually 4GB
	*
	*	The solution was to create the reserved space volume with the same _id and uuid as the VPG so we can be 100%
	*	sure that we only have 1 reserved space volume per VPG
	*/
	const originalCreateReservedSpaceVolume = VPGModule.createReservedSpaceVolume;
	const VPG = new TestableConcatenatedVPG();

	before(() => setup.newSetup().then(() => generateAndSaveTargets(3, 2)));

	it('Save', () => VPG.save());
	it('Extend', () => {
		let p1, p2;
		let firstTimeCallingCreateReservedSpaceVolume = true;

		VPGModule.createReservedSpaceVolume = (vpgWithReserve, user, cb) => {
			originalCreateReservedSpaceVolume(vpgWithReserve, user, (responses, logs) => {
				if (firstTimeCallingCreateReservedSpaceVolume) {
					firstTimeCallingCreateReservedSpaceVolume = false;
					p2 = VPG.extend(2 * FIFTY_GB, true);
					setTimeout(() => cb(responses, logs), 1000);
				} else {
					firstTimeCallingCreateReservedSpaceVolume = false;
					cb(responses, logs);
				}
			});
		};

		p1 = VPG.extend(3 * FIFTY_GB, true);

		return p1
			.then(response => {
				assert(!response.error);
				return p2;
			})
			.then(response => assertIsCausedBy(response.error, systemMessages.VPG_EXTEND_FAILED))
			.then(() => vpgCollection.findOne({ _id: VPG._id }, { capacity: 1 }))
			.then(vpgFromDB => volumeCollection.findOne({ _id: VPG._id, capacity: vpgFromDB.capacity }, { _id: 0 }))
			.then(volumeFromDB => assert(volumeFromDB, 'error: volume from DB capacity !== VPG from DB capacity'))
			.finally(() => utils.extendVolumes = originalCreateReservedSpaceVolume);
	});
}

describe('Volume Provisionning Groups', () => {
	before(() => dbManager.connect().then(() => {
		vpgCollection = app.get('db').collection('volumeProvisioningGroup');
		volumeCollection = app.get('db').collection('volume');
	}));

	after(() => dbManager.closeConnection());

	describe('Without Reserved Space', () => testVPGSuite());
	describe('With Reserved Space', () => testVPGSuite(true));
	describe('Race Conditions', testRaceConditions);
});
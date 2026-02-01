/*
 * SPDX-FileCopyrightText: Copyright (c) 2026 NVIDIA CORPORATION & AFFILIATES. All rights reserved.
 * SPDX-License-Identifier: Apache-2.0
 */

/* global app,log,describe,before,it,after */

const async = require('async');

const dbManager = require('./testUtils/dbManager.js');
const { setup, SetupOptions } = require('./testUtils/setup.js');
const assert = require('assert');

const lockUtils = require('./testUtils/lockUtils.js');
const { VolumeRAID1, VolumeConcatenated, VolumeRAID0, VolumeRAID10, VolumeEC, VolumeStripedEC } = require('./models/volume.js');
const { generateTargets, generateTargetsByIds, generateTarget } = require('./testUtils/entityGenerators.js');

const { TargetClass } = require('./models/targetClass.js');
const consts = require('../consts.js');
const { markVolumesForDeletion, handlePRaidStatusMessage } = require('../modules/volume.js');
const { evictDiskByDiskIDsAndUUIDs } = require('../modules/disk.js');
const { DiskClass, DiskClassEntry } = require('./models/diskClass.js');
const { getErrorChainString, failedToAllocateError, assertIsCausedBy } = require('./testUtils/errorUtils.js');
const { UpdatePRaidReportBuilder } = require('./kafkaMessages/fromTOMA/tomaMessageBuilders.js');
const systemMessages = require('../systemMessages.js');
const utils = require('../utils.js');
const zoneModule = require('../modules/zone.js');

const ZONE_1 = '1';
const ZONE_2 = '2';

var volumeCollection;

function generateAndSaveTargets(count, numOfDisks, zone) {
	let targets = generateTargets(count, zone, numOfDisks);
	return Promise.all(targets.map(t => t.save()));
}

class TestableVolume {
	constructor() {
		this.name = this.getName();
	}

	getName() { }
	getNewVolume() { }
	getMinimumNumOfTargets() { }
	getMinimumNumOfDrivesPerTarget() { }
	getVPG() { }
	validateLayout() { }

	basicVolumeTests(volume) {
		return volumeCollection.findOne({ _id: volume.name })
			.then(doc => {
				assert(doc);
				assert(doc.blocks, 'Volume has no blocks - bug in allocation');
				if (!volume.VPG)
					assert.strictEqual(doc.RAIDLevel, volume.RAIDLevel);
				assert.strictEqual(doc.capacity, volume.capacity);
				return doc;
			});
	}
}

class TestConcatenated extends TestableVolume {
	getName() { return 'Concatenated'; }
	getNewVolume() { return new VolumeConcatenated('concatenated'); }
	getMinimumNumOfTargets() { return 1; }
	getMinimumNumOfDrivesPerTarget() { return 1; }
	getVPG() { return 'DEFAULT_CONCATENATED_VPG'; }

	validateLayout(dbDoc) {
		assert(dbDoc.chunks);
		assert.strictEqual(dbDoc.chunks.length, 1);
		let chunk = dbDoc.chunks[0];
		assert.strictEqual(chunk.pRaids.length, 1, 'Concatenated volume should have a single pRaid per chunk');
		let pRaid = chunk.pRaids[0];
		assert.strictEqual(pRaid.diskSegments.length, 1, 'Non-Mirrored volume should have a single diskSegment per pRaid');
	}
}

class TestRAID0 extends TestableVolume {
	getName() { return 'RAID0'; }
	getNewVolume() { return new VolumeRAID0('raid0'); }
	getMinimumNumOfTargets() { return 1; }
	getMinimumNumOfDrivesPerTarget() { return 2; }
	getVPG() { return 'DEFAULT_RAID_0_VPG'; }

	validateLayout(dbDoc) {
		assert(dbDoc.chunks);
		assert.strictEqual(dbDoc.chunks.length, 1);
		let chunk = dbDoc.chunks[0];
		assert.strictEqual(chunk.pRaids.length, 2, 'Stripped volume should have 2 pRaids per chunk');
		chunk.pRaids.forEach(pRaid => {
			assert.strictEqual(pRaid.diskSegments.length, 1, 'Non-Mirrored volume should have a single diskSegment per pRaid');
		});
	}
}

class TestRAID1 extends TestableVolume {
	getName() { return 'RAID1'; }
	getNewVolume() { return new VolumeRAID1('raid1'); }
	getMinimumNumOfTargets() { return 2; }
	getMinimumNumOfDrivesPerTarget() { return 1; }
	getVPG() { return 'DEFAULT_RAID_1_VPG'; }

	validateLayout(dbDoc) {
		assert(dbDoc.chunks);
		assert.strictEqual(dbDoc.chunks.length, 1);
		let chunk = dbDoc.chunks[0];
		assert.strictEqual(chunk.pRaids.length, 1, 'Simple Mirrored volume should have a single pRaid per chunk');
		let pRaid = chunk.pRaids[0];
		assert.strictEqual(pRaid.diskSegments.length, 2, 'Mirrored volume should have 2 diskSegments per pRaid');
	}
}


class TestRAID10 extends TestableVolume {
	getName() { return 'RAID10'; }
	getNewVolume() { return new VolumeRAID10('raid10'); }
	getMinimumNumOfTargets() { return 2; }
	getMinimumNumOfDrivesPerTarget() { return 2; }
	getVPG() { return 'DEFAULT_RAID_10_VPG'; }

	validateLayout(dbDoc) {
		assert(dbDoc.chunks);
		assert.strictEqual(dbDoc.chunks.length, 1);
		let chunk = dbDoc.chunks[0];
		assert.strictEqual(chunk.pRaids.length, 2, 'Stripped volume should have 2 pRaids per chunk');
		chunk.pRaids.forEach(pRaid => {
			assert.strictEqual(pRaid.diskSegments.length, 2, 'Mirrored volume should have 2 diskSegments per pRaid');
		});
	}
}

class TestEC extends TestableVolume {
	getName() { return 'Erasure Coding'; }
	getNewVolume() { return new VolumeEC('ec'); }
	getMinimumNumOfTargets() { return 10; }
	getMinimumNumOfDrivesPerTarget() { return 1; }
	getVPG() { return 'DEFAULT_EC_DUAL_TARGET_REDUNDANCY_VPG'; }

	validateLayout(dbDoc, volume) {
		if (!volume)
			throw new Error('volume object was not provided');

		assert(dbDoc.chunks);
		assert.strictEqual(dbDoc.chunks.length, 1);
		let chunk = dbDoc.chunks[0];
		assert.strictEqual(chunk.pRaids.length, 1, 'Erasure Coding volume should have 1 pRaid per chunk');

		let diskSegmentsPerPRaid = dbDoc.dataBlocks + dbDoc.parityBlocks;
		chunk.pRaids.forEach(pRaid => {
			assert.strictEqual(pRaid.diskSegments.length, diskSegmentsPerPRaid,
				'EC volume should have dataBlocks + parityBlocks (' + diskSegmentsPerPRaid + ') diskSegments per pRaid but found ' + pRaid.diskSegments.length);
		});
	}
}

class TestStripedEC extends TestableVolume {
	getName() { return 'StripedEC'; }
	getNewVolume() { return new VolumeStripedEC('stripedEC'); }
	getMinimumNumOfTargets() { return 10; }
	getMinimumNumOfDrivesPerTarget() { return 2; }
	getVPG() { return 'DEFAULT_STRIPED_EC_DUAL_TARGET_REDUNDANCY_VPG'; }

	validateLayout(dbDoc, volume) {
		if (!volume)
			throw new Error('volume object was not provided');

		assert(dbDoc.chunks);
		assert.strictEqual(dbDoc.chunks.length, 1);
		let chunk = dbDoc.chunks[0];
		assert.strictEqual(chunk.pRaids.length, 2, 'StripedEC volume should have 2 pRaid per chunk');

		let diskSegmentsPerPRaid = dbDoc.dataBlocks + dbDoc.parityBlocks;
		chunk.pRaids.forEach(pRaid => {
			assert.strictEqual(pRaid.diskSegments.length, diskSegmentsPerPRaid,
				'EC volume should have dataBlocks + parityBlocks (' + diskSegmentsPerPRaid + ') diskSegments per pRaid but found ' + pRaid.diskSegments.length);
		});
	}
}

describe('Volumes', () => {
	before(() => {
		return dbManager.connect().then(() => {
			volumeCollection = app.get('db').collection('volume');
		});
	});

	after(()=>{
		return dbManager.closeConnection();
	});

	describe('Basic operations', function() {
		describe('#Concatenated', function() {
			testVolumeType(new TestConcatenated());
		});
	
		describe('#RAID 0', function() {
			testVolumeType(new TestRAID0());
		});
	
		describe('#RAID 1', function() {
			testVolumeType(new TestRAID1());
		});
	
		describe('#RAID 10', function() {
			testVolumeType(new TestRAID10());
		});
	
		describe('#Erasure Coding', function() {
			testVolumeType(new TestEC());
		});
	
		describe('#Striped Erasure Coding', () => {
			testVolumeType(new TestStripedEC());
		});

		function testVolumeType(testableVolume) {
			describe('Basic Creation', function() {
				before(() => {
					let minDisks = testableVolume.getMinimumNumOfDrivesPerTarget();
					let minTargets = testableVolume.getMinimumNumOfTargets();
					return setup.newSetup()
						.then(() => generateAndSaveTargets(minTargets, minDisks, ZONE_1));
				});
	
				it('Volume should be created', () => {
					let volume = testableVolume.getNewVolume();
	
					return volume.save()
						.then(result => {
							assert(result.success, 'error: ' + getErrorChainString(result.err));
						})
						.then(() => testableVolume.basicVolumeTests(volume))
						.then((dbDoc) => {
							testableVolume.validateLayout(dbDoc, volume);
						});
				});
	
				it('Lock should be released', () => {
					return lockUtils.makeSureLockIsReleased(ZONE_1);
				});
			});
	
			describe('Duplicate Name', function() {
	
				before(() => {
					let minDisks = testableVolume.getMinimumNumOfDrivesPerTarget();
					let minTargets = testableVolume.getMinimumNumOfTargets();
					return setup.newSetup()
						.then(() => generateAndSaveTargets(minTargets, minDisks, ZONE_1));
				});
	
				it('Volume should be created', () => {
					let volume = testableVolume.getNewVolume();
					volume._id = 'duplicate-name';
					volume.name = 'duplicate-name';
					return volume.save()
						.then(result => {
							assert(result.success, 'error: ' + getErrorChainString(result.err));
						})
						.then(() => testableVolume.basicVolumeTests(volume))
						.then((dbDoc) => {
							testableVolume.validateLayout(dbDoc, volume);
						});
				});
	
				it('Volume creation should fail with appropriate error', () => {
					let volume = testableVolume.getNewVolume();
					volume._id = 'duplicate-name';
					volume.name = 'duplicate-name';
	
					return volume.save()
						.then(result => {
							assert(!result.success, 'error: ' + getErrorChainString(result.err));
						});
				});
			});
	
			describe('Not enough Targets', function() {
				before(() => {
					let minDisks = testableVolume.getMinimumNumOfDrivesPerTarget();
					let minTargets = testableVolume.getMinimumNumOfTargets();
					return setup.newSetup()
						.then(() => generateAndSaveTargets(minTargets - 1, minDisks, ZONE_1));
				});
	
				it('Volume should fail to create', () => {
					let volume = testableVolume.getNewVolume();
	
					return volume.save()
						.then(result => {
							assert(!result.success, 'should return success = false');
							assert(result.error.innerMessage == failedToAllocateError);
						});
				});
	
				it('Lock should be released', () => {
					if (testableVolume.getMinimumNumOfTargets() - 1 > 0)
						return lockUtils.makeSureLockIsReleased(ZONE_1);
					else
						return Promise.resolve();
				});
			});
	
			describe('Not enough Drives', function() {
				before(() => {
					let minDisks = testableVolume.getMinimumNumOfDrivesPerTarget();
					let minTargets = testableVolume.getMinimumNumOfTargets();
					return setup.newSetup()
						.then(() => generateAndSaveTargets(minTargets, minDisks - 1, ZONE_1));
				});
	
				it('Volume should fail to create', () => {
					let volume = testableVolume.getNewVolume();
	
					return volume.save()
						.then(result => {
							assert(!result.success, 'should return success = false');
							assert(result.error.innerMessage == failedToAllocateError);
						});
				});
	
				it('Lock should be released', () => {
					if (testableVolume.getMinimumNumOfTargets() - 1 > 0)
						return lockUtils.makeSureLockIsReleased(ZONE_1);
					else
						return Promise.resolve();
				});
			});
	
			describe('Create from VPG', function() {
				let vpgName = testableVolume.getVPG();
				before(() => {
					let minDisks = testableVolume.getMinimumNumOfDrivesPerTarget();
					let minTargets = testableVolume.getMinimumNumOfTargets();
					return setup.newSetup()
						.then(() => generateAndSaveTargets(minTargets, minDisks, ZONE_1));
				});
	
				it('Volume should be created', () => {
					let volume = testableVolume.getNewVolume();
					volume.VPG = vpgName;
					return volume.save()
						.then(result => {
							assert(result.success, 'error: ' + getErrorChainString(result.err));
						})
						.then(() => testableVolume.basicVolumeTests(volume))
						.then((dbDoc) => {
							testableVolume.validateLayout(dbDoc, volume);
						});
				});
	
				it('Lock should be released', () => {
					return lockUtils.makeSureLockIsReleased(ZONE_1);
				});
			});
	
			describe('Create with TargetClass', function() {
				let minTargets = testableVolume.getMinimumNumOfTargets();
				// create double the amount of targets
				let targets = generateTargets(minTargets * 2, ZONE_1);
				let minRequiredTargetsIDs = targets.slice(0, minTargets).map(t => t.node_id);
				// create target class with the min. required num of targets
				let targetClass = new TargetClass('target_class_1', minRequiredTargetsIDs);
	
				before(() => {
					return setup.newSetup()
						.then(() => Promise.all(targets.map(t => t.save())))
						.then(() => targetClass.save());
				});
	
				it('Volume should be created from the given TargetClass', () => {
					let volume = testableVolume.getNewVolume();
					volume.serverClasses = [targetClass.name];
	
					return volume.save()
						.then(result => {
							assert(result.success, 'error: ' + getErrorChainString(result.err));
						})
						.then(() => testableVolume.basicVolumeTests(volume))
						.then(dbDoc => {
							testableVolume.validateLayout(dbDoc, volume);
							return dbDoc;
						})
						.then(dbDoc => {
							let targetClassNodeIDs = new Set(minRequiredTargetsIDs);
							dbDoc.chunks.forEach(chunk => {
								chunk.pRaids.forEach(pRaid => {
									pRaid.diskSegments.forEach(seg => {
										if (seg.type == consts.segmentTypes.DATA)
											assert(targetClassNodeIDs.has(seg.node_id),
												'Segments should only be created on nodeIDs from the specified targetClass. targetClass Nodes '
												+ Array.from(targetClassNodeIDs) + ' does not contain ' + seg.nodeID);
									});
								});
							});
						});
				});
				it('Lock should be released', () => {
					return lockUtils.makeSureLockIsReleased(ZONE_1);
				});
			});
	
			describe('Extend volume', function() {
				let volume = testableVolume.getNewVolume();
				let targets;
	
				before(() => {
					let minDisks = testableVolume.getMinimumNumOfDrivesPerTarget();
					let minTargets = testableVolume.getMinimumNumOfTargets();
	
					return setup.newSetup()
						.then(() => targets = generateTargets(minTargets, ZONE_1, minDisks))
						.then(() => Promise.all(targets.map(t => t.save())));
				});
	
				it('Volume should be created', () => {
					return volume.save()
						.then(result => {
							assert(result.success, 'error: ' + getErrorChainString(result.err));
						})
						.then(() => testableVolume.basicVolumeTests(volume))
						.then((dbDoc) => {
							testableVolume.validateLayout(dbDoc, volume);
						});
				});
	
				it('Extend Volume should fail if volume action is initializing', () => {
					volume.capacity = volume.capacity * 2;
					return volume.extend()
						.then(res => assertIsCausedBy(res.error, systemMessages.CANT_EXTEND_INITALIZING_VOLUME));
				});
	
				it('Report pRaids online', (done) => {
					volumeCollection.findOne({ _id: volume._id }, (err, vol) => {
						assert(!err);
	
						vol.chunks.forEach(c => c.pRaids.forEach(p => p.diskSegments.forEach(d => {
							d.status = consts.diskSegmentStatuses.NORMAL;
							d.vitality = consts.segmentVitality.UP;
						})));
						let msgBuilder = UpdatePRaidReportBuilder.fromVolume(vol, targets[0]);
	
						handlePRaidStatusMessage(msgBuilder.build(), () => {
							done();
						});
					});
				});
	
				it('Extend Volume should succeed', () => {
					return volume.extend()
						.then(res => assert(!res.error))
						.then(() => volumeCollection.findOne({ _id: volume._id }))
						.then(vol => assert(vol.capacity === volume.capacity));
				});
	
			});
	
	
			describe('Mark for Deletion', function() {
				let volume = testableVolume.getNewVolume();
				let targets;
	
				before(() => {
					let minDisks = testableVolume.getMinimumNumOfDrivesPerTarget();
					let minTargets = testableVolume.getMinimumNumOfTargets();
	
					return setup.newSetup()
						.then(() => targets = generateTargets(minTargets, ZONE_1, minDisks))
						.then(() => Promise.all(targets.map(t => t.save())));
				});
	
				it('Volume should be created', () => {
					return volume.save()
						.then(result => {
							assert(result.success, 'error: ' + getErrorChainString(result.err));
						})
						.then(() => testableVolume.basicVolumeTests(volume))
						.then((dbDoc) => {
							testableVolume.validateLayout(dbDoc, volume);
						});
				});
	
				it('Mark for Deletion should fail if volume action is initializing', (done) => {
					markVolumesForDeletion([volume], (logs) => {
						const results = logs.map(l => l.createApiResponse());
						assertIsCausedBy(results[0].error, systemMessages.CANT_DELETE_INITALIZING_VOLUME);
						done();
					});
				});
	
				it('Report pRaids online', (done) => {
					volumeCollection.findOne({ _id: volume._id }, (err, vol) => {
						assert(!err);
	
						vol.chunks.forEach(c => c.pRaids.forEach(p => p.diskSegments.forEach(d => {
							d.status = consts.diskSegmentStatuses.NORMAL;
							d.vitality = consts.segmentVitality.UP;
						})));
						let msgBuilder = UpdatePRaidReportBuilder.fromVolume(vol, targets[0]);
	
						handlePRaidStatusMessage(msgBuilder.build(), () => {
							done();
						});
					});
				});
	
				it('Mark for Deletion should succeed', (done) => {
					volumeCollection.findOne({ _id: volume._id }, { uuid: 1 }, (err, res) => {
						if (err) assert(err);
						volume.uuid = res.uuid;
						markVolumesForDeletion([volume], (logs) => {
							const results = logs.map(l => l.createApiResponse());
							let resultString = JSON.stringify(results);
							assert(results[0], resultString);
							assert(results[0].success, resultString);
							done();
						});
					});
				});
	
				it('Mark for Deletion should fail if volume already removed', (done) => {
					volumeCollection.deleteOne({ _id: volume._id })
						.then(() => {
							markVolumesForDeletion([volume], (logs) => {
								const results = logs.map(l => l.createApiResponse());
								let resultString = JSON.stringify(results);
								assert(results[0], resultString);
								assert(!results[0].success, resultString);
								assert(results[0].error);
								done();
							});
						});
				});
			});
		}
	});

	describe('#Allocation with Target and Disk Limiters', () => {
		let zone1Targets;
		let zone2Targets;

		before(() => {
			let disksPerTarget = 2;
			let targetsPerZone = 4;
			let zone1TargetIDs = Array(targetsPerZone).fill(0).map((val, i) => `server${i}_zone1`);
			zone1Targets = generateTargetsByIds(zone1TargetIDs, ZONE_1, disksPerTarget);

			let zone2TargetIDs = Array(targetsPerZone).fill(0).map((val, i) => `server${i + targetsPerZone}_zone2`);
			zone2Targets = generateTargetsByIds(zone2TargetIDs, ZONE_2, disksPerTarget);
			let targets = zone1Targets.concat(zone2Targets);

			let opts = new SetupOptions().setEnableZones(true);
			return setup.newSetup(opts)
				.then(() => log.debug('enableZones: ' + app.get('globalSettings').enableZones))
				.then(() => {
					return Promise.all(targets.map(t => t.save()));
				});
		});

		describe('Allocation with 2 zones', function() {
			it('Volume should be created', () => {
				let volume = new VolumeRAID10('raid10_1');
				return volume.save()
					.then(result => {
						assert(result.success, 'error: ' + getErrorChainString(result.err));
					})
					.then(() => volumeCollection.findOne({ _id: volume.name }))
					.then(dbDoc => {
						assert.ok(dbDoc);
						new TestRAID10().validateLayout(dbDoc);
					});
			});
		});

		describe('Limit to Drive ID with 2 zones', function() {
			it('Volume should be created', () => {
				let volume = new VolumeConcatenated('c1');
				let aDiskOnZone1 = zone1Targets[1].disks[1].diskID;
				let aDiskOnzone2 = zone2Targets[0].disks[0].diskID;

				// The intersection of all limitations should be zone2 it's first target and it's first disk
				volume.limitByDisks = [aDiskOnZone1, aDiskOnzone2];
				volume.limitByNodes = [
					zone1Targets[0].node_id,
					zone2Targets[0].node_id,
					zone2Targets[1].node_id
				];

				return volume.save()
					.then(result => {
						assert(result.success, 'error: ' + getErrorChainString(result.err));
					})
					.then(() => volumeCollection.findOne({ _id: volume.name }))
					.then(dbDoc => new TestConcatenated().validateLayout(dbDoc))
					.then(() => lockUtils.makeSureLockIsReleased(ZONE_1));
			});
		});

		describe('Limit to DriveClass', function() {
			it('Volume should be created', () => {
				let diskList = [
					new DiskClassEntry(zone1Targets[0].disks[0].diskID, zone1Targets[0].node_id),
					new DiskClassEntry(zone1Targets[1].disks[0].diskID, zone1Targets[1].node_id),
				];
				let diskClass = new DiskClass('firstDiskOnEachNode', diskList);
				let volume = new VolumeConcatenated('c2');
				let aDiskOnZone1 = zone1Targets[1].disks[1].diskID;
				let aDiskOnzone2 = zone2Targets[0].disks[0].diskID;

				// The intersection of all limitations should be zone2 it's first target and it's first disk
				volume.limitByDisks = [aDiskOnZone1, aDiskOnzone2];
				volume.limitByNodes = [
					zone1Targets[0].node_id,
					zone2Targets[0].node_id,
					zone2Targets[1].node_id
				];

				return diskClass.save()
					.then(result => {
						assert(result.success, result.error);
					})
					.then(() => volume.save())
					.then(result => {
						assert(result.success, 'error: ' + getErrorChainString(result.err));
					})
					.then(() => volumeCollection.findOne({ _id: volume.name }))
					.then(dbDoc => new TestConcatenated().validateLayout(dbDoc))
					.then(() => lockUtils.makeSureLockIsReleased(ZONE_1));
			});
		});

		describe('Allocation cross zone', function() {
			let volume = new VolumeConcatenated('j0');
			let diskClass, diskList = [];

			it('Volume should be created', () => {
				diskList.push(new DiskClassEntry(zone1Targets[0].disks[0].diskID, zone1Targets[0].node_id, zone1Targets[0].disks[0].Model));
				diskClass = new DiskClass('OneDiskFromEachZone', diskList);
				volume.capacity = consts.volumeCapacity.MAX;
				volume.diskClasses = [diskClass._id];
				return diskClass.save()
					.then(result => assert(result.success, result.error))
					.then(() => volume.save())
					.then(result => assert(result.success, 'error: ' + getErrorChainString(result.error)))
					.then(() => volumeCollection.findOne({ _id: volume.name }))
					.then(dbDoc => {
						assert.ok(dbDoc);
						new TestConcatenated().validateLayout(dbDoc);
					});
			});

			it('Report pRaids online', (done) => {
				volumeCollection.findOne({ _id: volume._id }, (err, vol) => {
					assert(!err);

					vol.chunks.forEach(c => c.pRaids.forEach(p => p.diskSegments.forEach(d => {
						d.status = consts.diskSegmentStatuses.NORMAL;
						d.vitality = consts.segmentVitality.UP;
					})));
					let msgBuilder = UpdatePRaidReportBuilder.fromVolume(vol, zone1Targets[0]);

					handlePRaidStatusMessage(msgBuilder.build(), () => {
						done();
					});
				});
			});

			it('Volume should not be extended to zone 2', () => {
				volume.capacity = consts.volumeCapacity.MAX;
				diskList.push(new DiskClassEntry(zone2Targets[0].disks[0].diskID, zone2Targets[0].node_id, zone2Targets[0].disks[0].Model));

				return diskClass.update()
					.then(result => assert(result.success, result.error))
					.then(() => volume.extend())
					.then(result => assert(!result.success));
			});
		});
	});

	describe('#Advanced allocations', () => {
		describe('Should succeed when using VPG w/o reserved space while first zone used offline', () => {
			const RAID_1_VPG = 'DEFAULT_RAID_1_VPG';
			const originalGetZonesRank = zoneModule.getZonesRanks;
			const targets = [
				generateTarget('server1', '1'),
				generateTarget('server2', '1'),
				generateTarget('server3', '2'),
				generateTarget('server4', '2'),				
			];

			before(async() => {
				await setup.newSetup(new SetupOptions().setEnableZones(true));
				await Promise.all(targets.map(t => t.save()));

				// force volume allocation to start with zone 2
				zoneModule.getZonesRanks = () => ({ '1': 0, '2': 1 });
			});

			after(() => zoneModule.getZonesRanks = originalGetZonesRank);

			it('should bring down server3', async() => {
				const target = targets[2];
				
				await target.timedOut();
				
				const dbTarget = await app.get('db').collection('server').findOne({ _id: target._id }, { health: 1 });
				assert.strictEqual(dbTarget.health, consts.targetHealth.CRITICAL);
			});

			it('should succeed to save volume on zone 1', async() => {
				const volume = new VolumeRAID1('r1');
				volume.VPG = RAID_1_VPG;

				const result = await volume.save();
				assert(result.success, JSON.stringify(result.error));
				
				const dbVolume = await app.get('db').collection('volume').findOne({ _id: volume._id }, { 'chunks.pRaids.zone': 1 });
				assert.strictEqual('1', dbVolume.chunks[0].pRaids[0].zone);
			});
		});
	});

	describe('#Race conditions', () => {
		let targets;
		before(() => {
			return setup.newSetup()
				.then(() => targets = generateTargets(3, ZONE_1, 2))
				.then(() => Promise.all(targets.map(t => t.save())));
		});

		/*
		*	Flow Description:
		*	1GB JBOD volume exists
		* 	2 users are extending the same volume at the same time - each user is extending via a different management in the same cluster
		*	the first extend volume processed will extend to 2GB but get stuck in the middle of the extendVolume flow
		* 	the second extend volume processed will extend to 4GB and succeed
		*	the first extend volume finished to be stuck and finish to process the request - NVMESH-2343
		* 	the result is that the volume is extended to capacity === 2GB, while it have 3 chunks:
		* 	1GB(original), 3GB(from the extend to 4GB), 1GB(from the extend to 2GB)
		*
		*	The solution was to complete the volume extension only if the volume version did not change - otherwise rollback
		*/
		describe('Race Between Extend Volumes', () => {
			const volume = new VolumeConcatenated('volume');

			it('Should create volume', () => {
				return volume.save()
					.then(result => assert(result.success, 'error: ' + getErrorChainString(result.error)));
			});

			it('Report pRaids online', (done) => {
				volumeCollection.findOne({ _id: volume._id }, (err, vol) => {
					assert(!err);

					vol.chunks.forEach(c => c.pRaids.forEach(p => p.diskSegments.forEach(d => {
						d.status = consts.diskSegmentStatuses.NORMAL;
						d.vitality = consts.segmentVitality.UP;
					})));
					let msgBuilder = UpdatePRaidReportBuilder.fromVolume(vol, targets[0]);

					handlePRaidStatusMessage(msgBuilder.build(), () => {
						done();
					});
				});
			});

			it('should succeed extend volume only if volume version did not change in the middle', () => {
				const originalCreateVolumeExtensionFunction = utils.createVolumeExtension;
				let firstTimeCallingCreateVolumeExtension = true;
				let p1, p2;

				function waitForVolumeVersion(volumeID, version, callback) {
					let count = 0;

					function testVolumeVersion(cb) {
						volumeCollection.findOne({ _id: volumeID, version }, { projection: { _id: 1 } }, (_, res) => cb(null, !res));
					}

					function iteratee(cb) {
						if (count >= 10)
							throw new Error('max retries exceeded while waiting for volume version');
						count++;
						setTimeout(() => cb(), 500);
					}

					async.whilst(testVolumeVersion, iteratee, callback);
				}

				function startSecondExtension() {
					volume.capacity = 2 * volume.capacity;
					p2 = volume.extend();
				}

				utils.createVolumeExtension = (volume, newCapacity, user, callback) => {
					if (firstTimeCallingCreateVolumeExtension) {
						firstTimeCallingCreateVolumeExtension = false;
						startSecondExtension();
						waitForVolumeVersion(volume._id, 2, () => originalCreateVolumeExtensionFunction(volume, newCapacity, user, callback));
					} else {
						firstTimeCallingCreateVolumeExtension = false;
						originalCreateVolumeExtensionFunction(volume, newCapacity, user, callback);
					}
				};

				volume.capacity = 2 * volume.capacity;
				p1 = volume.extend();

				return p1
					.then(response => {
						assertIsCausedBy(response.error, systemMessages.EXTEND_VOLUME_VERSION_FAILED);
						return p2;
					})
					.then(response => {
						assert(!response.error);
					})
					.then(() => volumeCollection.findOne({ _id: volume._id }, { projection: { capacity: 1 } }))
					.then(vol => assert(vol.capacity === volume.capacity))
					.finally(() => utils.createVolumeExtension = originalCreateVolumeExtensionFunction);
			});
		});

		/*
		*	Problem Description (NVMESH-2768):
		*	1. Protected volume w/o VPG exists
		* 	2. User evicts disk used by the same volume
		*	3. TOMA send an healthy pRaid report about the same volume (this report includes the diskSegment with 'remap' status as healthy) - may
		*	happen for example if TOMA did not consume the up to date HW config following evict yet
		* 	4. Management was overwriting the diskSegment status with 'normal'
		*
		*	The solution was to prevent such situation in handlePRaidStatusMessage
		*/
		describe('Race between evict drive and healthy pRaid update', () => {
			function reportPRAIDOnline(cb) {
				volumeCollection.findOne({ _id: volume._id }, (err, vol) => {
					assert(!err);

					vol.chunks.forEach(c => c.pRaids.forEach(p => p.diskSegments.forEach(d => {
						d.status = consts.diskSegmentStatuses.NORMAL;
						d.vitality = consts.segmentVitality.UP;
					})));
					let msgBuilder = UpdatePRaidReportBuilder.fromVolume(vol, targets[0]);

					handlePRaidStatusMessage(msgBuilder.build(), () => {
						cb();
					});
				});
			}

			const volume = new VolumeRAID1('r1');
			let diskToEvict;

			it('Should create volume', () => {
				return volume.save()
					.then(result => assert(result.success, 'error: ' + getErrorChainString(result.error)));
			});

			it('Report pRaids online', (done) => {
				reportPRAIDOnline(done);
			});

			it('Should evict disk', (done) => {
				app.get('db').collection('volume').findOne({ _id: volume.name }, (err, res) => {
					diskToEvict = res.chunks[0].pRaids[0].diskSegments[0];
					const disk = { diskID: diskToEvict.diskID, uuid: diskToEvict.diskUUID };
					evictDiskByDiskIDsAndUUIDs([disk], consts.SYSTEM_USER, false, null, null, null, (logs) => {
						const results = logs.map(l => l.createApiResponse());
						assert(results[0].success);

						app.get('db').collection('volume').findOne({ _id: volume.name }, (err, dbVolume) => {
							assert(!err);

							const diskSegmentFromEvictedDisk = dbVolume.chunks[0].pRaids[0].diskSegments.find(ds => ds.diskID === diskToEvict.diskID);
							assert(diskSegmentFromEvictedDisk.status === consts.diskSegmentStatuses.REMAP);

							done();
						});
					});
				});
			});

			it('Report pRaids online should not override disk segment remap status', (done) => {
				reportPRAIDOnline(() => {
					app.get('db').collection('volume').findOne({ _id: volume.name }, (err, dbVolume) => {
						assert(!err);
						assert(dbVolume.status === consts.volumeStatuses.ONLINE);
						assert(dbVolume.health === consts.targetHealth.ALARM);
						assert(dbVolume.action === consts.volumeActions.REBUILD_REQUIRED);

						const diskSegmentFromEvictedDisk = dbVolume.chunks[0].pRaids[0].diskSegments.find(ds => ds.diskID === diskToEvict.diskID);
						assert(diskSegmentFromEvictedDisk.status === consts.diskSegmentStatuses.REMAP);

						done();
					});
				});
			});
		});
	});
});

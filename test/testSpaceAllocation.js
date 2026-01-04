/*
 * SPDX-FileCopyrightText: Copyright (c) 2026 NVIDIA CORPORATION & AFFILIATES. All rights reserved.
 * SPDX-License-Identifier: Apache-2.0
 */

/* global app,describe,before,it,after */

const dbManager = require('./testUtils/dbManager.js');
const assert = require('assert');

const { evictDiskByDiskIDsAndUUIDs } = require('../modules/disk.js');
const { setup } = require('./testUtils/setup.js');
const { generateTarget, generateTargets, generateDisk } = require('./testUtils/entityGenerators.js');
const { VolumeRAID1, VolumeConcatenated, VolumeEC, VolumeRAID10 } = require('./models/volume.js');
const consts = require('../consts.js');
const { UpdatePRaidReportBuilder } = require('./kafkaMessages/fromTOMA/tomaMessageBuilders.js');
const { handlePRaidStatusMessage, rebuildVolumes } = require('../modules/volume.js');
const zoneModule = require('../modules/zone.js');
const PB = 1000000;

describe('Get Space Allocation', function() {

	before(() => {
		return dbManager.connect();
	});

	after(() => {
		return dbManager.closeConnection();
	});

	describe('#Zero Space', function() {
		before(() => {
			return setup.newSetup();
		});

		it('should return 0 space', (done) => {
			let nodeMatch = {};
			let diskMatch = {};
			zoneModule.getSpaceAllocation(nodeMatch, diskMatch, false, (err, results) => {
				assert(!err);
				assert.strictEqual(results.availableSpace, 0);
				assert.strictEqual(results.data, 0);
				assert.strictEqual(results.fromReserved, 0);
				assert.strictEqual(results.redundancy, 0);
				assert.strictEqual(results.reservedLeft, 0);
				assert.strictEqual(results.totalCapacity, 0);
				assert.strictEqual(results.totalReserved, 0);

				done();
			});
		});
	});

	describe('#All space is available', function() {
		const TOTAL_CAPACITY = 1597.21;

		before(() => {
			let target1 = generateTarget('server1.acme.com', '1');
			return setup.newSetup()
				.then(() => target1.save());
		});

		it('should return correct space', (done) => {
			let nodeMatch = {};
			let diskMatch = {};
			zoneModule.getSpaceAllocation(nodeMatch, diskMatch, false, (err, results) => {
				assert(!err);
				assert.strictEqual(results.availableSpace, TOTAL_CAPACITY);
				assert.strictEqual(results.data, 0);
				assert.strictEqual(results.fromReserved, 0);
				assert.strictEqual(results.redundancy, 0);
				assert.strictEqual(results.reservedLeft, 0);
				assert.strictEqual(results.totalCapacity, TOTAL_CAPACITY);
				assert.strictEqual(results.totalReserved, 0);

				done();
			});
		});
	});

	describe('#All space is available with limitByNode', function() {
		const TOTAL_CAPACITY = 1597.21;

		before(() => {
			let target1 = generateTarget('server1.acme.com', '1');
			let target2 = generateTarget('server2.acme.com', '1');
			return setup.newSetup()
				.then(() => target1.save())
				.then(() => target2.save());
		});

		it('should return correct space', (done) => {
			let nodeMatch = {
				node_status: 1,
				isPending: { '$ne': true },
				node_id: { '$in': ['server1.acme.com'] }
			};
			let diskMatch = {};
			zoneModule.getSpaceAllocation(nodeMatch, diskMatch, false, (err, results) => {
				assert(!err);
				assert.strictEqual(results.availableSpace, TOTAL_CAPACITY);
				assert.strictEqual(results.data, 0);
				assert.strictEqual(results.fromReserved, 0);
				assert.strictEqual(results.redundancy, 0);
				assert.strictEqual(results.reservedLeft, 0);
				assert.strictEqual(results.totalCapacity, TOTAL_CAPACITY);
				assert.strictEqual(results.totalReserved, 0);

				done();
			});
		});
	});


	describe('#All space is available with limitByDisk', function() {
		const TOTAL_CAPACITY = 798.6;

		before(() => {
			let target1 = generateTarget('server1.acme.com', '1');
			return setup.newSetup()
				.then(() => target1.save());
		});

		it('should return correct space', (done) => {
			let nodeMatch = {
				node_status: 1,
				isPending: { '$ne': true },
				node_id: { '$in': ['server1.acme.com'] }
			};
			let diskMatch = {
				'disks.status': { $in: ['Ok', 'Initializing'] },
				'disks.isExcluded': { $ne: true },
				'disks.isOutOfService': { $ne: true },
				'disks.isPendingFormat': { $ne: true },
				'disks.diskID': {
					$in: [
						'SERVER1.1',
					],
				},
			};
			zoneModule.getSpaceAllocation(nodeMatch, diskMatch, false, (err, results) => {
				assert(!err);
				assert.strictEqual(results.availableSpace, TOTAL_CAPACITY);
				assert.strictEqual(results.data, 0);
				assert.strictEqual(results.fromReserved, 0);
				assert.strictEqual(results.redundancy, 0);
				assert.strictEqual(results.reservedLeft, 0);
				assert.strictEqual(results.totalCapacity, TOTAL_CAPACITY);
				assert.strictEqual(results.totalReserved, 0);

				done();
			});
		});
	});

	describe('#Volume exists - No limit - R1', () => {
		const DATA_SEGMENT_SIZE = 1;
		const TOTAL_CAPACITY = 4791.62;
		const FREE_SPACE_LEFT = TOTAL_CAPACITY - 2 * DATA_SEGMENT_SIZE;
		let volume;

		before(() => {
			let targets = generateTargets(3, '1');
			return setup.newSetup()
				.then(() => Promise.all(targets.map(t => t.save())));
		});

		it('should create R1 volume', (done) => {
			volume = new VolumeRAID1('v1');
			volume.limitByNodes = ['test-server-0', 'test-server-1'];
			volume.save().then((result) => {
				assert(result.success);
				done();
			});
		});

		it('should return correct available space', (done) => {
			zoneModule.getSpaceAllocation({}, {}, false, (err, results) => {
				assert(!err);
				assert.strictEqual(results.availableSpace, FREE_SPACE_LEFT);
				assert.strictEqual(results.data, DATA_SEGMENT_SIZE);
				assert.strictEqual(results.fromReserved, 0);
				assert.strictEqual(results.redundancy, DATA_SEGMENT_SIZE);
				assert.strictEqual(results.reservedLeft, 0);
				assert.strictEqual(results.totalCapacity, TOTAL_CAPACITY);
				assert.strictEqual(results.totalReserved, 0);

				done();
			});
		});
	});

	describe('#Volume exists - limitByDisk - CONCATENATED', () => {
		const DATA_SEGMENT_SIZE = 1;
		const TOTAL_CAPACITY = 1597.21;
		const FREE_SPACE_LEFT = TOTAL_CAPACITY - DATA_SEGMENT_SIZE;
		let volume;

		before(() => {
			let targets = generateTargets(3, '1');
			return setup.newSetup()
				.then(() => Promise.all(targets.map(t => t.save())));
		});

		it('should create CONCATENATED volume', (done) => {
			volume = new VolumeConcatenated('v1');
			volume.limitByNodes = ['test-server-0'];
			volume.limitByDisks = ['TEST-SERVER-0.1'];
			volume.save()
				.then((result) => {
					assert(result.success);
					done();
				});
		});

		it('should return correct available space', (done) => {
			let nodeMatch = {
				node_status: 1,
				isPending: { '$ne': true },
				node_id: { '$in': ['test-server-0'] }
			};
			let diskMatch = {
				'disks.status': { $in: ['Ok', 'Initializing'] },
				'disks.isExcluded': { $ne: true },
				'disks.isOutOfService': { $ne: true },
				'disks.isPendingFormat': { $ne: true },
				'disks.diskID': {
					$in: [
						'TEST-SERVER-0.1',
						'TEST-SERVER-0.2'
					]
				},
			};
			zoneModule.getSpaceAllocation(nodeMatch, diskMatch, false, (err, results) => {
				assert(!err);
				assert.strictEqual(results.availableSpace, FREE_SPACE_LEFT);
				assert.strictEqual(results.data, DATA_SEGMENT_SIZE);
				assert.strictEqual(results.fromReserved, 0);
				assert.strictEqual(results.redundancy, 0);
				assert.strictEqual(results.reservedLeft, 0);
				assert.strictEqual(results.totalCapacity, TOTAL_CAPACITY);
				assert.strictEqual(results.totalReserved, 0);

				done();
			});
		});
	});

	describe('#Volume exists - limitByDisk - R1', () => {
		const DATA_SEGMENT_SIZE = 1;
		const TOTAL_CAPACITY = 1597.21;
		const FREE_SPACE_LEFT = TOTAL_CAPACITY - 2 * DATA_SEGMENT_SIZE;
		let volume;

		before(() => {
			let targets = generateTargets(2, '1');
			return setup.newSetup()
				.then(() => Promise.all(targets.map(t => t.save())));
		});

		it('should create R1 volume', (done) => {
			volume = new VolumeRAID1('v1');
			volume.limitByNodes = ['test-server-0', 'test-server-1'];
			volume.limitByDisks = ['TEST-SERVER-0.1', 'TEST-SERVER-1.1'];
			volume.save().then((result) => {
				assert(result.success);
				done();
			});
		});

		it('should return correct available space', (done) => {
			let nodeMatch = {
				node_status: 1,
				isPending: { '$ne': true },
				node_id: { '$in': volume.limitByNodes }
			};
			let diskMatch = {
				'disks.status': { $in: ['Ok', 'Initializing'] },
				'disks.isExcluded': { $ne: true },
				'disks.isOutOfService': { $ne: true },
				'disks.isPendingFormat': { $ne: true },
				'disks.diskID': { $in: volume.limitByDisks },
			};

			zoneModule.getSpaceAllocation(nodeMatch, diskMatch, false, (err, results) => {
				assert(!err);
				assert.strictEqual(results.availableSpace, FREE_SPACE_LEFT);
				assert.strictEqual(results.data, DATA_SEGMENT_SIZE);
				assert.strictEqual(results.fromReserved, 0);
				assert.strictEqual(results.redundancy, DATA_SEGMENT_SIZE);
				assert.strictEqual(results.reservedLeft, 0);
				assert.strictEqual(results.totalCapacity, TOTAL_CAPACITY);
				assert.strictEqual(results.totalReserved, 0);

				done();
			});
		});
	});

	describe('#Volume exists - limitByDisk - EC 8+2', () => {
		const DATA_SEGMENT_SIZE = 1;
		const TOTAL_CAPACITY = 1597.21;
		const FREE_SPACE_LEFT = 1595.96;
		let volume;

		before(() => {
			let targets = generateTargets(10, '1');
			return setup.newSetup()
				.then(() => Promise.all(targets.map(t => t.save())));
		});

		it('should create EC 8+2 volume', (done) => {
			volume = new VolumeEC('v1');
			volume.limitByNodes = ['test-server-0', 'test-server-1', 'test-server-2', 'test-server-3', 'test-server-4', 'test-server-5',
				'test-server-6', 'test-server-7', 'test-server-8', 'test-server-9'];
			volume.limitByDisks = ['TEST-SERVER-0.1', 'TEST-SERVER-1.1', 'TEST-SERVER-2.1', 'TEST-SERVER-3.1', 'TEST-SERVER-4.1',
				'TEST-SERVER-5.1', 'TEST-SERVER-6.1', 'TEST-SERVER-7.1', 'TEST-SERVER-8.1', 'TEST-SERVER-9.1'];
			volume.protectionLevel = consts.ecSeparationTypes.FULL;
			volume.capacity = 10;
			volume.save().then((result) => {
				assert(result.success);
				done();
			});
		});

		it('should return correct available space for first node', (done) => {
			let nodeMatch = {
				node_status: 1,
				isPending: { '$ne': true },
				node_id: { '$in': [volume.limitByNodes[0]] }
			};
			let diskMatch = {
				'disks.status': { $in: ['Ok', 'Initializing'] },
				'disks.isExcluded': { $ne: true },
				'disks.isOutOfService': { $ne: true },
				'disks.isPendingFormat': { $ne: true },
				'disks.diskID': {
					$in: [
						'TEST-SERVER-0.1',
						'TEST-SERVER-0.2'
					]
				},
			};

			zoneModule.getSpaceAllocation(nodeMatch, diskMatch, false, (err, results) => {
				assert(!err);
				assert.strictEqual(results.availableSpace, FREE_SPACE_LEFT);
				assert.strictEqual(results.data, DATA_SEGMENT_SIZE);
				assert.strictEqual(results.fromReserved, 0);
				assert.strictEqual(results.redundancy, 0.25 * DATA_SEGMENT_SIZE);
				assert.strictEqual(results.reservedLeft, 0);
				assert.strictEqual(results.totalCapacity, TOTAL_CAPACITY);
				assert.strictEqual(results.totalReserved, 0);

				done();
			});
		});
	});

	function makeDiskHuge(disk) {
		disk.blocks = 194972240000;
		disk.availableBlocks = 193464576000;
		disk.usableBlocks = 193464576000;
		disk.largestSegmentAvailable = {
			lbs: 1507392,
			lbe: 193466083392,
			blocks: 193464576000
		};
		disk.GPT.firstUsableLba = 288;
		disk.GPT.lastUsableLba = 193466083392;
	}


	describe('10PT volume exists', () => {
		const TOTAL_SPACE = 10301681.98;
		let volume;

		before(() => {
			let targets = generateTargets(13, '1', 1); // 13 targets * 1 disks of ~792 TB = 10.296 PB
			targets.forEach(t => t.disks.forEach(d => makeDiskHuge(d)));
			return setup.newSetup().then(() => Promise.all(targets.map(t => t.save())));
		});

		it('should create 10PT Concatenated Volume', (done) => {
			volume = new VolumeConcatenated('v1');
			volume.capacity = 10 * PB;
			volume.save().then((result) => {
				assert(result.success);
				done();
			});
		});

		it('should return correct available space', (done) => {
			zoneModule.getSpaceAllocation({}, {}, false, (err, results) => {
				assert(!err);
				assert.strictEqual(results.availableSpace, Math.round((TOTAL_SPACE - 10 * PB) * 100) / 100);
				assert.strictEqual(results.data, 10 * PB);
				assert.strictEqual(results.fromReserved, 0);
				assert.strictEqual(results.redundancy, 0);
				assert.strictEqual(results.reservedLeft, 0);
				assert.strictEqual(results.totalCapacity, TOTAL_SPACE);
				assert.strictEqual(results.totalReserved, 0);

				done();
			});
		});
	});

	describe('4PT R1 volume exists', () => {
		const TOTAL_SPACE = 20603363.96;
		let volume;

		before(() => {
			let targets = generateTargets(13, '1', 2); // 13 targets * 2 disks of ~792 TB = 20.6 PB
			targets.forEach(t => t.disks.forEach(d => makeDiskHuge(d)));
			return setup.newSetup().then(() => Promise.all(targets.map(t => t.save())));
		});

		it('should create 10PT Concatenated Volume', (done) => {
			volume = new VolumeRAID1('v1');
			volume.capacity = 8 * PB;
			volume.save().then((result) => {
				assert(result.success);
				done();
			});
		});

		it('should return correct available space', (done) => {
			zoneModule.getSpaceAllocation({}, {}, false, (err, results) => {
				assert(!err);
				assert.strictEqual(results.availableSpace, Math.round((TOTAL_SPACE - 2 * 8 * PB) * 100) / 100);
				assert.strictEqual(results.data, 8 * PB);
				assert.strictEqual(results.fromReserved, 0);
				assert.strictEqual(results.redundancy, 8 * PB);
				assert.strictEqual(results.reservedLeft, 0);
				assert.strictEqual(results.totalCapacity, TOTAL_SPACE);
				assert.strictEqual(results.totalReserved, 0);

				done();
			});
		});
	});

	describe('4PT R10 volume exists', () => {
		const TOTAL_SPACE = 20603363.96;
		let volume;

		before(() => {
			let targets = generateTargets(13, '1', 2); // 13 targets * 2 disks of ~792 TB = 20.6 PB
			targets.forEach(t => t.disks.forEach(d => makeDiskHuge(d)));
			return setup.newSetup().then(() => Promise.all(targets.map(t => t.save())));
		});

		it('should create 10PT Concatenated Volume', (done) => {
			volume = new VolumeRAID10('v1');
			volume.capacity = 8 * PB;
			volume.save().then((result) => {
				assert(result.success);
				done();
			});
		});

		it('should return correct available space', (done) => {
			zoneModule.getSpaceAllocation({}, {}, false, (err, results) => {
				assert(!err);
				assert.strictEqual(results.availableSpace, Math.round((TOTAL_SPACE - 2 * 8 * PB) * 100) / 100);
				assert.strictEqual(results.data, 8 * PB);
				assert.strictEqual(results.fromReserved, 0);
				assert.strictEqual(results.redundancy, 8 * PB);
				assert.strictEqual(results.reservedLeft, 0);
				assert.strictEqual(results.totalCapacity, TOTAL_SPACE);
				assert.strictEqual(results.totalReserved, 0);

				done();
			});
		});
	});

	describe('6PT EC volume exists', () => {
		const TOTAL_SPACE = 30905045.94;
		let volume;

		before(() => {
			let targets = generateTargets(13, '1', 3); // 13 targets * 3 disks of ~792 TB = 30.9 PB
			targets.forEach(t => t.disks.forEach(d => makeDiskHuge(d)));
			return setup.newSetup().then(() => Promise.all(targets.map(t => t.save())));
		});

		it('should create 10PT Concatenated Volume', (done) => {
			volume = new VolumeEC('v1');
			volume.capacity = 9 * PB;
			volume.save().then((result) => {
				assert(result.success);
				done();
			});
		});

		it('should return correct available space', (done) => {
			zoneModule.getSpaceAllocation({}, {}, false, (err, results) => {
				assert(!err);
				assert.strictEqual(results.availableSpace, TOTAL_SPACE - 9 * PB - 9 * PB / 4);
				assert.strictEqual(results.data, 9 * PB - 0.01); // "- 0.01" is due to getSpaceAllocation precision of 2 digits
				assert.strictEqual(results.fromReserved, 0);
				assert.strictEqual(results.redundancy, 9 * PB / 4);
				assert.strictEqual(results.reservedLeft, 0);
				assert.strictEqual(results.totalCapacity, TOTAL_SPACE - 0.01); // "- 0.01" is due to getSpaceAllocation precision of 2 digits
				assert.strictEqual(results.totalReserved, 0);

				done();
			});
		});
	});

	describe('Maximum EC allocation', () => {
		let volume;

		before(() => {
			let targets = generateTargets(10, '1', 1);
			return setup.newSetup().then(() => Promise.all(targets.map(t => t.save())));
		});

		it('should create MAX EC Volume', (done) => {
			volume = new VolumeEC('v1');
			volume.capacity = 'MAX';
			volume.save().then((result) => {
				assert(result.success);
				done();
			});
		});

		it('should return correct available space', (done) => {
			zoneModule.getSpaceAllocation({}, {}, false, (err, results) => {
				assert(!err);
				assert.strictEqual(results.availableSpace, 0);
				assert.strictEqual(results.data, 6388.82);
				assert.strictEqual(results.fromReserved, 0);
				assert.strictEqual(results.redundancy, 1597.21);
				assert.strictEqual(results.reservedLeft, 0);
				assert.strictEqual(results.totalCapacity, 7986.03);
				assert.strictEqual(results.totalReserved, 0);
				done();
			});
		});
	});


	describe('After Protected Volume Rebuilded', () => {
		let targets, volumeR1, volumeEC, diskDetails;
		const BASE_SPACE_ALLOCATION = {
			availableSpace: 7982.78,
			data: 2,
			fromReserved: 0,
			redundancy: 1.25,
			reservedLeft: 0,
			totalCapacity: 7986.03,
			totalReserved: 0,
		};

		before(() => {
			targets = generateTargets(10, '1', 1);
			return setup.newSetup().then(() => Promise.all(targets.map(t => t.save())));
		});

		it('should create volumes with online status', (done) => {
			volumeR1 = new VolumeRAID1('r1');
			volumeEC = new VolumeEC('ec1');

			function doCreateVolume(volume, cb) {
				volume.save().then((result) => {
					assert(result.success);
					app.get('db').collection('volume').findOne({ _id: volume._id }, (err, vol) => {
						assert(!err);

						vol.chunks.forEach(c => c.pRaids.forEach(p => p.diskSegments.forEach(d => {
							d.status = consts.diskSegmentStatuses.NORMAL;
							d.vitality = consts.segmentVitality.UP;
						})));

						handlePRaidStatusMessage(UpdatePRaidReportBuilder.fromVolume(vol, targets[0]).build(), () => cb());
					});
				});
			}

			doCreateVolume(volumeR1, () => doCreateVolume(volumeEC, done));
		});

		it('should return correct available space', (done) => {
			zoneModule.getSpaceAllocation({}, {}, false, (err, results) => {
				assert(!err);
				assert.strictEqual(results.availableSpace, BASE_SPACE_ALLOCATION.availableSpace);
				assert.strictEqual(results.data, BASE_SPACE_ALLOCATION.data);
				assert.strictEqual(results.fromReserved, BASE_SPACE_ALLOCATION.fromReserved);
				assert.strictEqual(results.redundancy, BASE_SPACE_ALLOCATION.redundancy);
				assert.strictEqual(results.reservedLeft, BASE_SPACE_ALLOCATION.reservedLeft);
				assert.strictEqual(results.totalCapacity, BASE_SPACE_ALLOCATION.totalCapacity);
				assert.strictEqual(results.totalReserved, BASE_SPACE_ALLOCATION.fromReserved);
				done();
			});
		});

		it('should evict disk used by both volumes', (done) => {
			app.get('db').collection('server').find({}, { projection: { 'disks': 1	} }).toArray()
				.then(servers => {
					const serverWithBothVolumes = servers.find(s => s.disks[0]?.diskSegments?.length === 2);
					const diskWithBothVolumes = serverWithBothVolumes.disks[0];
					diskDetails = { diskID: diskWithBothVolumes.diskID, uuid: diskWithBothVolumes.uuid, nodeID: diskWithBothVolumes.nodeID };

					evictDiskByDiskIDsAndUUIDs([diskDetails], consts.SYSTEM_USER, false, null, null, null, logs => {
						const results = logs.map(l => l.createApiResponse());
						assert(results[0].success);
						done();
					});
				});
		});

		it('should add new disk on same server we evicted the disk', () => {
			const targetWithEvictedDisk = targets.find(s => s.node_id === diskDetails.nodeID);
			targetWithEvictedDisk.addDisk(generateDisk(targetWithEvictedDisk.node_id, targetWithEvictedDisk.uuid, 2));
			targetWithEvictedDisk.messageSequence += 1;
			return targetWithEvictedDisk.sendReport();
		});

		it('should return correct available space after evict', (done) => {
			zoneModule.getSpaceAllocation({}, {}, false, (err, results) => {
				assert(!err);
				assert.strictEqual(results.availableSpace, 7983.91);
				assert.strictEqual(results.data, 1.4);
				assert.strictEqual(results.fromReserved, 0);
				assert.strictEqual(results.redundancy, 0.72);
				assert.strictEqual(results.reservedLeft, 0);
				assert.strictEqual(results.totalCapacity, 7986.03);
				assert.strictEqual(results.totalReserved, 0);
				done();
			});
		});


		it('rebuild volumes', (done) => {
			rebuildVolumes([{ _id: volumeR1._id, uuid: volumeR1.uuid }, { _id: volumeEC._id, uuid: volumeEC.uuid }], consts.SYSTEM_USER, logs => {
				const results = logs.map(l => l.createApiResponse());
				assert(results[0].success);
				assert(results[1].success);
				done();
			});
		});

		it('Should change volumes to None-Online after toma reports all normal', (done) => {
			function doReportByVolume(volume, cb) {
				app.get('db').collection('volume').findOne({ _id: volume._id }, (err, volume) => {
					assert(!err);
					assert(volume);

					let pRaid = volume.chunks[0].pRaids[0];

					pRaid.diskSegments.forEach((seg) => {
						if (seg.status == consts.diskSegmentStatuses.MARKED_FOR_REBUILD_OLD)
							seg.status = consts.diskSegmentStatuses.DEPRECATED;
						else
							seg.status = consts.diskSegmentStatuses.NORMAL;
					});

					handlePRaidStatusMessage(UpdatePRaidReportBuilder.fromVolume(volume, targets[0]).build(), () => cb());
				});
			}

			doReportByVolume(volumeR1, () => doReportByVolume(volumeEC, done));
		});

		it('should return correct available space after rebuild - like at the beggining', (done) => {
			zoneModule.getSpaceAllocation({}, {}, false, (err, results) => {
				assert(!err);
				assert.strictEqual(results.availableSpace, BASE_SPACE_ALLOCATION.availableSpace);
				assert.strictEqual(results.data, BASE_SPACE_ALLOCATION.data);
				assert.strictEqual(results.fromReserved, BASE_SPACE_ALLOCATION.fromReserved);
				assert.strictEqual(results.redundancy, BASE_SPACE_ALLOCATION.redundancy);
				assert.strictEqual(results.reservedLeft, BASE_SPACE_ALLOCATION.reservedLeft);
				assert.strictEqual(results.totalCapacity, BASE_SPACE_ALLOCATION.totalCapacity);
				assert.strictEqual(results.totalReserved, BASE_SPACE_ALLOCATION.fromReserved);
				done();
			});
		});
	});
});

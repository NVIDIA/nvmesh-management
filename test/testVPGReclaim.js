/*
 * SPDX-FileCopyrightText: Copyright (c) 2026 NVIDIA CORPORATION & AFFILIATES. All rights reserved.
 * SPDX-License-Identifier: Apache-2.0
 */

/* global app, describe, before, after, it */

const consts = require('../consts');
const dbManager = require('./testUtils/dbManager');
const assert = require('assert');
const { setup } = require('./testUtils/setup');
const { generateTargets } = require('./testUtils/entityGenerators');
const VPGModule = require('../modules/volumeProvisioningGroup');
const utils = require('../utils');
const { Entities } = require('../modules/error.js');
const USER = { email: consts.SYSTEM_USER };
let vpgCollection, volumeCollection, serverCollection;

function generateAndSaveTargets(count, numOfDisks) {
	let targets = generateTargets(count, numOfDisks);
	return Promise.all(targets.map(t => t.save()));
}

function saveVPG(name, capacity, RAIDLevel, extraAttrs = {}) {
	return new Promise((resolve, reject) => {
		const vpg = { name, RAIDLevel, capacity, allowOverflow: true, ...extraAttrs };
		VPGModule.saveVPGs([vpg], USER, logs => {
			const res = logs.map(l => l.createApiResponse(Entities.VPG.ID, Entities.VPG.UUID))[0];
			if (res.error) return reject(res.error);
			resolve(res);
		});
	});
}

function reclaimVPG(vpgId, vpgUuid) {
	return new Promise((resolve, reject) => {
		VPGModule.reclaimVPGs([{ _id: vpgId, uuid: vpgUuid }], USER, logs => {
			const res = logs.map(l => l.createApiResponse(Entities.VPG.ID, Entities.VPG.UUID))[0];
			if (res.error) return reject(res.error);
			resolve(res);
		});
	});
}

function reclaimVPGRaw(vpgId, vpgUuid) {
	return new Promise((resolve) => {
		VPGModule.reclaimVPGs([{ _id: vpgId, uuid: vpgUuid }], USER, logs => {
			const res = logs.map(l => l.createApiResponse(Entities.VPG.ID, Entities.VPG.UUID))[0];
			resolve(res);
		});
	});
}

function createVolume(name, capacity, RAIDLevel, vpgName, extraAttrs = {}) {
	return new Promise((resolve, reject) => {
		const volume = { _id: name, name, capacity, RAIDLevel, VPG: vpgName, ...extraAttrs };
		utils.createVolumes([volume], USER, logs => {
			const res = logs.map(l => l.createApiResponse(Entities.Volume.ID, Entities.Volume.UUID))[0];
			if (res.error) return reject(res.error);
			resolve(res);
		});
	});
}

function forceDeleteVolume(volumeId) {
	return new Promise((resolve, reject) => {
		volumeCollection.findOne({ _id: volumeId }, (err, vol) => {
			if (err || !vol) return reject(err || `Volume ${volumeId} not found`);
			utils.forceDeleteVolumes([vol], null, false, (err) => {
				if (err) return reject(err);
				resolve();
			});
		});
	});
}

function getReservedVolume(vpgId) {
	return volumeCollection.findOne({ _id: vpgId, isReserved: true });
}

function getReservedDiskSegments(vpgId) {
	return serverCollection.aggregate([
		{ $unwind: '$disks' },
		{ $unwind: '$disks.diskSegments' },
		{ $match: { 'disks.diskSegments.isReserved': true, 'disks.diskSegments.volumeName': vpgId } },
		{ $project: { diskSegment: '$disks.diskSegments' } }
	]).toArray().then(results => results.map(r => r.diskSegment));
}

function getDerivedDiskSegments() {
	return serverCollection.aggregate([
		{ $unwind: '$disks' },
		{ $unwind: '$disks.diskSegments' },
		{ $match: { 'disks.diskSegments.fromReserved': true } },
		{ $project: { diskSegment: '$disks.diskSegments' } }
	]).toArray().then(results => results.map(r => r.diskSegment));
}

function getPendingSegments(vpgId) {
	return serverCollection.aggregate([
		{ $unwind: '$disks' },
		{ $unwind: '$disks.diskSegments' },
		{ $match: { 'disks.diskSegments.pendingReclaim.vpgId': vpgId } },
		{ $project: { diskSegment: '$disks.diskSegments' } }
	]).toArray().then(results => results.map(r => r.diskSegment));
}

function assertChunkInvariants(vol) {
	assert.ok(vol.chunks.length > 0, 'Should have at least one chunk');

	let expectedVlbs = 0;
	vol.chunks.forEach((chunk, chunkIdx) => {
		assert.strictEqual(chunk.vlbs, expectedVlbs,
			`Chunk ${chunkIdx} vlbs should be ${expectedVlbs}, got ${chunk.vlbs}`);
		assert.ok(chunk.vlbe >= chunk.vlbs,
			`Chunk ${chunkIdx} vlbe (${chunk.vlbe}) should be >= vlbs (${chunk.vlbs})`);
		expectedVlbs = chunk.vlbe + 1;

		chunk.pRaids.forEach((pRaid, pRaidIdx) => {
			const blockCounts = pRaid.diskSegments.map(ds => ds.lbe - ds.lbs + 1);
			const uniqueBlockCounts = [...new Set(blockCounts)];
			assert.strictEqual(uniqueBlockCounts.length, 1,
				`Chunk ${chunkIdx} pRaid ${pRaidIdx} has mixed segment sizes: ${blockCounts.join(', ')}`);
		});
	});
}

describe('VPG Reclaim', () => {
	before(() => dbManager.connect().then(() => {
		vpgCollection = app.get('db').collection('volumeProvisioningGroup');
		volumeCollection = app.get('db').collection('volume');
		serverCollection = app.get('db').collection('server');
	}));

	after(() => dbManager.closeConnection());

	describe('Concatenated - reclaim with no derived volumes', () => {
		const VPG_NAME = 'reclaim_concat';
		const VPG_CAPACITY = 50;
		let vpgUuid;

		before(() => setup.newSetup()
			.then(() => generateAndSaveTargets(3, 4))
			.then(() => saveVPG(VPG_NAME, VPG_CAPACITY, consts.RAIDLevel.CONCATENATED))
			.then(res => { vpgUuid = res.uuid; })
		);

		it('should reclaim all space and delete reserved volume', () => {
			return reclaimVPG(VPG_NAME, vpgUuid)
				.then(() => vpgCollection.findOne({ _id: VPG_NAME }))
				.then(vpg => {
					assert.strictEqual(vpg.capacity, 0, 'VPG capacity should be 0');
				})
				.then(() => getReservedVolume(VPG_NAME))
				.then(vol => {
					assert.strictEqual(vol, null, 'Reserved volume should be deleted');
				})
				.then(() => getReservedDiskSegments(VPG_NAME))
				.then(segs => {
					assert.strictEqual(segs.length, 0, 'No reserved segments should remain');
				});
		});
	});

	describe('RAID-1 - basic reclaim', () => {
		const VPG_NAME = 'reclaim_r1';
		const VPG_CAPACITY = 50;
		let vpgUuid;

		before(() => setup.newSetup()
			.then(() => generateAndSaveTargets(3, 4))
			.then(() => saveVPG(VPG_NAME, VPG_CAPACITY, consts.RAIDLevel.MIRRORED_RAID_1, { numberOfMirrors: 1 }))
			.then(res => { vpgUuid = res.uuid; })
			.then(() => createVolume(`${VPG_NAME}_v1`, 10, consts.RAIDLevel.MIRRORED_RAID_1, VPG_NAME, { numberOfMirrors: 1 }))
			.then(() => createVolume(`${VPG_NAME}_v2`, 10, consts.RAIDLevel.MIRRORED_RAID_1, VPG_NAME, { numberOfMirrors: 1 }))
			.then(() => createVolume(`${VPG_NAME}_v3`, 10, consts.RAIDLevel.MIRRORED_RAID_1, VPG_NAME, { numberOfMirrors: 1 }))
		);

		it('should reclaim unused space (50GB -> 30GB)', () => {
			return reclaimVPG(VPG_NAME, vpgUuid)
				.then(() => vpgCollection.findOne({ _id: VPG_NAME }))
				.then(vpg => {
					assert.strictEqual(Math.round(vpg.capacity), 30, 'VPG capacity should be 30GB');
				})
				.then(() => getReservedVolume(VPG_NAME))
				.then(vol => {
					assert.ok(vol, 'Reserved volume should still exist');
					assert.strictEqual(Math.round(vol.capacity), 30, 'Reserved volume capacity should be 30GB');
					assert.strictEqual(vol.reclaimAction, undefined, 'reclaimAction should be cleared');
					assertChunkInvariants(vol);
				})
				.then(() => getPendingSegments(VPG_NAME))
				.then(segs => {
					assert.strictEqual(segs.length, 0, 'No pending segments should remain');
				});
		});

		it('should return nothing-to-reclaim on second reclaim', () => {
			return reclaimVPGRaw(VPG_NAME, vpgUuid)
				.then(res => {
					assert.ok(res.error, 'Should return error when nothing to reclaim');
				});
		});
	});

	describe('RAID-1 - reclaim with interior gap', () => {
		const VPG_NAME = 'reclaim_r1_gap';
		const VPG_CAPACITY = 50;
		let vpgUuid;

		before(() => setup.newSetup()
			.then(() => generateAndSaveTargets(3, 4))
			.then(() => saveVPG(VPG_NAME, VPG_CAPACITY, consts.RAIDLevel.MIRRORED_RAID_1, { numberOfMirrors: 1 }))
			.then(res => { vpgUuid = res.uuid; })
			.then(() => createVolume(`${VPG_NAME}_v1`, 10, consts.RAIDLevel.MIRRORED_RAID_1, VPG_NAME, { numberOfMirrors: 1 }))
			.then(() => createVolume(`${VPG_NAME}_v2`, 10, consts.RAIDLevel.MIRRORED_RAID_1, VPG_NAME, { numberOfMirrors: 1 }))
			.then(() => createVolume(`${VPG_NAME}_v3`, 10, consts.RAIDLevel.MIRRORED_RAID_1, VPG_NAME, { numberOfMirrors: 1 }))
			.then(() => forceDeleteVolume(`${VPG_NAME}_v2`))
		);

		it('should reclaim the interior gap (50GB -> 20GB)', () => {
			return reclaimVPG(VPG_NAME, vpgUuid)
				.then(() => vpgCollection.findOne({ _id: VPG_NAME }))
				.then(vpg => {
					assert.strictEqual(Math.round(vpg.capacity), 20, 'VPG capacity should be 20GB');
				})
				.then(() => getReservedVolume(VPG_NAME))
				.then(vol => {
					assert.ok(vol, 'Reserved volume should still exist');
					assert.strictEqual(Math.round(vol.capacity), 20, 'Reserved volume capacity should be 20GB');
					assertChunkInvariants(vol);
				});
		});

		it('reserved segments should tightly cover only derived volumes', () => {
			return Promise.all([getReservedDiskSegments(VPG_NAME), serverCollection.aggregate([
				{ $unwind: '$disks' },
				{ $unwind: '$disks.diskSegments' },
				{ $match: { 'disks.diskSegments.fromReserved': true } },
				{ $project: { diskSegment: '$disks.diskSegments' } }
			]).toArray()])
				.then(([reservedSegs, derivedResults]) => {
					const derivedSegs = derivedResults.map(r => r.diskSegment);
					assert.ok(reservedSegs.length > 0, 'Should have reserved segments');
					assert.ok(derivedSegs.length > 0, 'Should have derived segments');

					for (const derived of derivedSegs) {
						const covering = reservedSegs.find(r =>
							r.diskID === derived.diskID && r.lbs <= derived.lbs && r.lbe >= derived.lbe
						);
						assert.ok(covering,
							`Derived segment [${derived.lbs}-${derived.lbe}] on ${derived.diskID} not covered by any reserved segment`);
					}
				});
		});
	});

	describe('RAID-1 - 5 volumes, delete middle one, verify segment grouping', () => {
		const VPG_NAME = 'reclaim_r1_group';
		const VPG_CAPACITY = 60;
		let vpgUuid;

		before(() => setup.newSetup()
			.then(() => generateAndSaveTargets(3, 4))
			.then(() => saveVPG(VPG_NAME, VPG_CAPACITY, consts.RAIDLevel.MIRRORED_RAID_1, { numberOfMirrors: 1 }))
			.then(res => { vpgUuid = res.uuid; })
			.then(() => createVolume(`${VPG_NAME}_v1`, 10, consts.RAIDLevel.MIRRORED_RAID_1, VPG_NAME, { numberOfMirrors: 1 }))
			.then(() => createVolume(`${VPG_NAME}_v2`, 10, consts.RAIDLevel.MIRRORED_RAID_1, VPG_NAME, { numberOfMirrors: 1 }))
			.then(() => createVolume(`${VPG_NAME}_v3`, 10, consts.RAIDLevel.MIRRORED_RAID_1, VPG_NAME, { numberOfMirrors: 1 }))
			.then(() => createVolume(`${VPG_NAME}_v4`, 10, consts.RAIDLevel.MIRRORED_RAID_1, VPG_NAME, { numberOfMirrors: 1 }))
			.then(() => createVolume(`${VPG_NAME}_v5`, 10, consts.RAIDLevel.MIRRORED_RAID_1, VPG_NAME, { numberOfMirrors: 1 }))
			.then(() => forceDeleteVolume(`${VPG_NAME}_v3`))
		);

		it('should reclaim the gap (60GB -> 40GB)', () => {
			return reclaimVPG(VPG_NAME, vpgUuid)
				.then(() => vpgCollection.findOne({ _id: VPG_NAME }))
				.then(vpg => {
					assert.strictEqual(Math.round(vpg.capacity), 40, 'VPG capacity should be 40GB');
				});
		});

		it('reserved volume chunks should have uniform segment sizes', () => {
			return getReservedVolume(VPG_NAME)
				.then(vol => {
					assert.ok(vol, 'Reserved volume should exist');
					assertChunkInvariants(vol);
				});
		});

		it('should have exactly 2 contiguous groups of reserved segments per disk', () => {
			return getReservedDiskSegments(VPG_NAME)
				.then(reservedSegs => {
					assert.ok(reservedSegs.length > 0, 'Should have reserved segments');

					// Group reserved segments by diskID
					const segsByDisk = {};
					reservedSegs.forEach(seg => {
						if (!segsByDisk[seg.diskID])
							segsByDisk[seg.diskID] = [];
						segsByDisk[seg.diskID].push(seg);
					});

					// Each disk should have exactly 2 reserved segments (one for v1+v2, one for v4+v5)
					// because v3 was deleted, creating a gap that splits the reservation into 2 groups
					Object.keys(segsByDisk).forEach(diskID => {
						const segs = segsByDisk[diskID].sort((a, b) => a.lbs - b.lbs);
						assert.strictEqual(segs.length, 2,
							`Disk ${diskID} should have 2 reserved segments (2 contiguous groups), got ${segs.length}`);

						// The two segments should not overlap or be adjacent (there's a gap between them)
						assert.ok(segs[1].lbs > segs[0].lbe + 1,
							`Gap expected between segments on ${diskID}: [${segs[0].lbs}-${segs[0].lbe}] and [${segs[1].lbs}-${segs[1].lbe}]`);
					});
				});
		});

		it('every derived segment should be covered by a reserved segment', () => {
			return Promise.all([getReservedDiskSegments(VPG_NAME), serverCollection.aggregate([
				{ $unwind: '$disks' },
				{ $unwind: '$disks.diskSegments' },
				{ $match: { 'disks.diskSegments.fromReserved': true } },
				{ $project: { diskSegment: '$disks.diskSegments' } }
			]).toArray()])
				.then(([reservedSegs, derivedResults]) => {
					const derivedSegs = derivedResults.map(r => r.diskSegment);
					assert.ok(derivedSegs.length > 0, 'Should have derived segments');

					for (const derived of derivedSegs) {
						const covering = reservedSegs.find(r =>
							r.diskID === derived.diskID && r.lbs <= derived.lbs && r.lbe >= derived.lbe
						);
						assert.ok(covering,
							`Derived segment [${derived.lbs}-${derived.lbe}] on ${derived.diskID} not covered by any reserved segment`);
					}
				});
		});

		it('no pending segments should remain', () => {
			return getPendingSegments(VPG_NAME)
				.then(segs => {
					assert.strictEqual(segs.length, 0, 'No pending segments should remain');
				});
		});
	});

	describe('RAID-1 - delete all volumes then reclaim', () => {
		const VPG_NAME = 'reclaim_r1_all_del';
		const VPG_CAPACITY = 30;
		let vpgUuid;

		before(() => setup.newSetup()
			.then(() => generateAndSaveTargets(3, 4))
			.then(() => saveVPG(VPG_NAME, VPG_CAPACITY, consts.RAIDLevel.MIRRORED_RAID_1, { numberOfMirrors: 1 }))
			.then(res => { vpgUuid = res.uuid; })
			.then(() => createVolume(`${VPG_NAME}_v1`, 10, consts.RAIDLevel.MIRRORED_RAID_1, VPG_NAME, { numberOfMirrors: 1 }))
			.then(() => createVolume(`${VPG_NAME}_v2`, 10, consts.RAIDLevel.MIRRORED_RAID_1, VPG_NAME, { numberOfMirrors: 1 }))
			.then(() => forceDeleteVolume(`${VPG_NAME}_v1`))
			.then(() => forceDeleteVolume(`${VPG_NAME}_v2`))
		);

		it('should delete reserved volume and set VPG capacity to 0', () => {
			return reclaimVPG(VPG_NAME, vpgUuid)
				.then(() => vpgCollection.findOne({ _id: VPG_NAME }))
				.then(vpg => {
					assert.strictEqual(vpg.capacity, 0, 'VPG capacity should be 0');
				})
				.then(() => getReservedVolume(VPG_NAME))
				.then(vol => {
					assert.strictEqual(vol, null, 'Reserved volume should be deleted');
				})
				.then(() => getReservedDiskSegments(VPG_NAME))
				.then(segs => {
					assert.strictEqual(segs.length, 0, 'No reserved segments should remain');
				});
		});
	});

	describe('RAID-1 - reclaim then allocate new volume', () => {
		const VPG_NAME = 'recl_then_alloc';
		const VPG_CAPACITY = 50;
		let vpgUuid;

		before(() => setup.newSetup()
			.then(() => generateAndSaveTargets(3, 4))
			.then(() => saveVPG(VPG_NAME, VPG_CAPACITY, consts.RAIDLevel.MIRRORED_RAID_1, { numberOfMirrors: 1 }))
			.then(res => { vpgUuid = res.uuid; })
			.then(() => createVolume(`${VPG_NAME}_v1`, 10, consts.RAIDLevel.MIRRORED_RAID_1, VPG_NAME, { numberOfMirrors: 1 }))
			.then(() => reclaimVPG(VPG_NAME, vpgUuid))
		);

		it('should allocate a new volume from the reclaimed reserved space', () => {
			return createVolume(`${VPG_NAME}_v2`, 5, consts.RAIDLevel.MIRRORED_RAID_1, VPG_NAME, { numberOfMirrors: 1 })
				.then(() => volumeCollection.findOne({ _id: `${VPG_NAME}_v2` }))
				.then(vol => {
					assert.ok(vol, 'New volume should be created');
					assert.ok(vol.chunks.length > 0, 'New volume should have chunks');
				});
		});
	});

	describe('RAID-1 - head gap reclaim (delete first volume)', () => {
		const VPG_NAME = 'recl_head_gap';
		const VPG_CAPACITY = 40;
		let vpgUuid;

		before(() => setup.newSetup()
			.then(() => generateAndSaveTargets(3, 4))
			.then(() => saveVPG(VPG_NAME, VPG_CAPACITY, consts.RAIDLevel.MIRRORED_RAID_1, { numberOfMirrors: 1 }))
			.then(res => { vpgUuid = res.uuid; })
			.then(() => createVolume(`${VPG_NAME}_v1`, 10, consts.RAIDLevel.MIRRORED_RAID_1, VPG_NAME, { numberOfMirrors: 1 }))
			.then(() => createVolume(`${VPG_NAME}_v2`, 10, consts.RAIDLevel.MIRRORED_RAID_1, VPG_NAME, { numberOfMirrors: 1 }))
			.then(() => forceDeleteVolume(`${VPG_NAME}_v1`))
		);

		it('should reclaim head gap (40GB -> 10GB)', () => {
			return reclaimVPG(VPG_NAME, vpgUuid)
				.then(() => vpgCollection.findOne({ _id: VPG_NAME }))
				.then(vpg => {
					assert.strictEqual(Math.round(vpg.capacity), 10, 'VPG capacity should be 10GB');
				})
				.then(() => getReservedVolume(VPG_NAME))
				.then(vol => {
					assert.ok(vol, 'Reserved volume should still exist');
					assertChunkInvariants(vol);
				});
		});

		it('derived segment should be covered by reserved segment', () => {
			return Promise.all([getReservedDiskSegments(VPG_NAME), getDerivedDiskSegments()])
				.then(([reservedSegs, derivedSegs]) => {
					for (const derived of derivedSegs) {
						const covering = reservedSegs.find(r =>
							r.diskID === derived.diskID && r.lbs <= derived.lbs && r.lbe >= derived.lbe
						);
						assert.ok(covering, `Derived [${derived.lbs}-${derived.lbe}] on ${derived.diskID} not covered`);
					}
				});
		});
	});

	describe('RAID-1 - multiple gaps (delete v2 and v4 out of 5)', () => {
		const VPG_NAME = 'recl_multi_gap';
		const VPG_CAPACITY = 60;
		let vpgUuid;

		before(() => setup.newSetup()
			.then(() => generateAndSaveTargets(3, 4))
			.then(() => saveVPG(VPG_NAME, VPG_CAPACITY, consts.RAIDLevel.MIRRORED_RAID_1, { numberOfMirrors: 1 }))
			.then(res => { vpgUuid = res.uuid; })
			.then(() => createVolume(`${VPG_NAME}_v1`, 10, consts.RAIDLevel.MIRRORED_RAID_1, VPG_NAME, { numberOfMirrors: 1 }))
			.then(() => createVolume(`${VPG_NAME}_v2`, 10, consts.RAIDLevel.MIRRORED_RAID_1, VPG_NAME, { numberOfMirrors: 1 }))
			.then(() => createVolume(`${VPG_NAME}_v3`, 10, consts.RAIDLevel.MIRRORED_RAID_1, VPG_NAME, { numberOfMirrors: 1 }))
			.then(() => createVolume(`${VPG_NAME}_v4`, 10, consts.RAIDLevel.MIRRORED_RAID_1, VPG_NAME, { numberOfMirrors: 1 }))
			.then(() => createVolume(`${VPG_NAME}_v5`, 10, consts.RAIDLevel.MIRRORED_RAID_1, VPG_NAME, { numberOfMirrors: 1 }))
			.then(() => forceDeleteVolume(`${VPG_NAME}_v2`))
			.then(() => forceDeleteVolume(`${VPG_NAME}_v4`))
		);

		it('should reclaim both gaps (60GB -> 30GB)', () => {
			return reclaimVPG(VPG_NAME, vpgUuid)
				.then(() => vpgCollection.findOne({ _id: VPG_NAME }))
				.then(vpg => {
					assert.strictEqual(Math.round(vpg.capacity), 30, 'VPG capacity should be 30GB');
				});
		});

		it('should have 3 contiguous groups of reserved segments per disk', () => {
			return getReservedDiskSegments(VPG_NAME)
				.then(reservedSegs => {
					const segsByDisk = {};
					reservedSegs.forEach(seg => {
						if (!segsByDisk[seg.diskID])
							segsByDisk[seg.diskID] = [];
						segsByDisk[seg.diskID].push(seg);
					});

					Object.keys(segsByDisk).forEach(diskID => {
						const segs = segsByDisk[diskID].sort((a, b) => a.lbs - b.lbs);
						assert.strictEqual(segs.length, 3,
							`Disk ${diskID} should have 3 reserved segments, got ${segs.length}`);
					});
				});
		});

		it('chunk invariants should hold', () => {
			return getReservedVolume(VPG_NAME)
				.then(vol => {
					assert.ok(vol, 'Reserved volume should exist');
					assertChunkInvariants(vol);
				});
		});
	});

	describe('VPG with no capacity', () => {
		const VPG_NAME = 'recl_no_cap';
		let vpgUuid;

		before(() => setup.newSetup()
			.then(() => generateAndSaveTargets(3, 4))
			.then(() => saveVPG(VPG_NAME, 0, consts.RAIDLevel.MIRRORED_RAID_1, { numberOfMirrors: 1 }))
			.then(res => { vpgUuid = res.uuid; })
		);

		it('should return nothing-to-reclaim', () => {
			return reclaimVPGRaw(VPG_NAME, vpgUuid)
				.then(res => {
					assert.ok(res.error, 'Should return error for VPG with no capacity');
				});
		});
	});

	describe('VPG fully allocated (reservation matches derived volume exactly)', () => {
		const VPG_NAME = 'recl_fully_alloc';
		const VPG_CAPACITY = 10;
		let vpgUuid;

		before(() => setup.newSetup()
			.then(() => generateAndSaveTargets(3, 4))
			.then(() => saveVPG(VPG_NAME, VPG_CAPACITY, consts.RAIDLevel.MIRRORED_RAID_1, { numberOfMirrors: 1 }))
			.then(res => { vpgUuid = res.uuid; })
			.then(() => createVolume(`${VPG_NAME}_v1`, VPG_CAPACITY, consts.RAIDLevel.MIRRORED_RAID_1, VPG_NAME, { numberOfMirrors: 1 }))
		);

		it('should expose allocatedBlocks == reservedBlocks in capacity usage', () => {
			return new Promise((resolve, reject) => {
				VPGModule.getVolumesCapacityUsageByID(VPG_NAME, (usage) => {
					try {
						assert.ok(usage, 'usage should be returned');
						assert.strictEqual(typeof usage.allocatedBlocks, 'number', 'allocatedBlocks should be exposed');
						assert.strictEqual(typeof usage.reservedBlocks, 'number', 'reservedBlocks should be exposed');
						assert.ok(usage.reservedBlocks > 0, 'reservedBlocks should be > 0');
						assert.strictEqual(usage.allocatedBlocks, usage.reservedBlocks,
							`allocatedBlocks (${usage.allocatedBlocks}) should equal reservedBlocks ` +
							`(${usage.reservedBlocks}) when derived consumes the full reservation`);
						// Sanity-check that the old capacity-GB comparison would have been fooled.
						assert.ok(usage.allocatedCapacity < VPG_CAPACITY,
							`allocatedCapacity (${usage.allocatedCapacity}) should be < vpg.capacity ` +
							`(${VPG_CAPACITY}) due to blockset rounding — this is why GB-compare was wrong`);
						resolve();
					} catch (err) {
						reject(err);
					}
				});
			});
		});

		it('should return nothing-to-reclaim and not change VPG state', () => {
			return vpgCollection.findOne({ _id: VPG_NAME })
				.then(vpgBefore => {
					const capacityBefore = vpgBefore.capacity;
					return reclaimVPGRaw(VPG_NAME, vpgUuid)
						.then(res => {
							assert.ok(res.error, 'Should return error when VPG is fully allocated');
						})
						.then(() => vpgCollection.findOne({ _id: VPG_NAME }))
						.then(vpgAfter => {
							assert.strictEqual(vpgAfter.capacity, capacityBefore,
								'VPG capacity should be unchanged after failed reclaim');
						})
						.then(() => getReservedVolume(VPG_NAME))
						.then(vol => {
							assert.ok(vol, 'Reserved volume should still exist');
							assert.strictEqual(vol.reclaimAction, undefined,
								'reclaimAction flag should be cleared (not stuck IN_PROGRESS)');
						})
						.then(() => getPendingSegments(VPG_NAME))
						.then(segs => {
							assert.strictEqual(segs.length, 0, 'No pending segments should remain');
						});
				});
		});
	});

	describe('Default VPG rejection', () => {
		it('should reject reclaim on default VPG', () => {
			return setup.newSetup()
				.then(() => generateAndSaveTargets(3, 4))
				.then(() => vpgCollection.findOne({ isDefault: true }))
				.then(defaultVPG => {
					assert.ok(defaultVPG, 'Default VPG should exist');
					return reclaimVPGRaw(defaultVPG._id, defaultVPG.uuid)
						.then(res => {
							assert.ok(res.error, 'Should return error for default VPG');
						});
				});
		});
	});

	describe('RAID-1 - disk availableBlocks increased after reclaim', () => {
		const VPG_NAME = 'recl_avail_blocks';
		const VPG_CAPACITY = 50;
		let vpgUuid, availableBlocksBefore;

		before(function() {
			return setup.newSetup()
				.then(() => generateAndSaveTargets(3, 4))
				.then(() => saveVPG(VPG_NAME, VPG_CAPACITY, consts.RAIDLevel.MIRRORED_RAID_1, { numberOfMirrors: 1 }))
				.then(res => { vpgUuid = res.uuid; })
				.then(() => createVolume(`${VPG_NAME}_v1`, 10, consts.RAIDLevel.MIRRORED_RAID_1, VPG_NAME, { numberOfMirrors: 1 }))
				.then(() => {
					return serverCollection.aggregate([
						{ $unwind: '$disks' },
						{ $group: { _id: null, total: { $sum: '$disks.availableBlocks' } } }
					]).toArray().then(result => { availableBlocksBefore = result[0].total; });
				});
		});

		it('should increase disk availableBlocks after reclaim', () => {
			return reclaimVPG(VPG_NAME, vpgUuid)
				.then(() => serverCollection.aggregate([
					{ $unwind: '$disks' },
					{ $group: { _id: null, total: { $sum: '$disks.availableBlocks' } } }
				]).toArray())
				.then(result => {
					const availableBlocksAfter = result[0].total;
					assert.ok(availableBlocksAfter > availableBlocksBefore,
						`availableBlocks should increase: before=${availableBlocksBefore}, after=${availableBlocksAfter}`);
				});
		});
	});

	describe('RAID-1 - reservedUUID updated on derived segments', () => {
		const VPG_NAME = 'recl_res_uuid';
		const VPG_CAPACITY = 50;
		let vpgUuid;

		before(() => setup.newSetup()
			.then(() => generateAndSaveTargets(3, 4))
			.then(() => saveVPG(VPG_NAME, VPG_CAPACITY, consts.RAIDLevel.MIRRORED_RAID_1, { numberOfMirrors: 1 }))
			.then(res => { vpgUuid = res.uuid; })
			.then(() => createVolume(`${VPG_NAME}_v1`, 10, consts.RAIDLevel.MIRRORED_RAID_1, VPG_NAME, { numberOfMirrors: 1 }))
			.then(() => createVolume(`${VPG_NAME}_v2`, 10, consts.RAIDLevel.MIRRORED_RAID_1, VPG_NAME, { numberOfMirrors: 1 }))
		);

		it('disk-level derived segments reservedUUID should reference current reserved segments', () => {
			return reclaimVPG(VPG_NAME, vpgUuid)
				.then(() => Promise.all([getReservedDiskSegments(VPG_NAME), getDerivedDiskSegments()]))
				.then(([reservedSegs, derivedSegs]) => {
					const reservedUUIDs = new Set(reservedSegs.map(s => s.uuid));

					for (const derived of derivedSegs) {
						assert.ok(derived.reservedUUID, 'Derived segment should have reservedUUID');
						assert.ok(reservedUUIDs.has(derived.reservedUUID),
							`Disk-level reservedUUID ${derived.reservedUUID} should reference an existing reserved segment`);
					}
				});
		});

		it('volume-level derived segments reservedUUID should reference current reserved segments', () => {
			return Promise.all([
				getReservedDiskSegments(VPG_NAME),
				volumeCollection.find({ VPG: VPG_NAME, _id: { $ne: VPG_NAME }, isReserved: { $ne: true } }).toArray()
			]).then(([reservedSegs, derivedVols]) => {
				const reservedUUIDs = new Set(reservedSegs.map(s => s.uuid));

				for (const vol of derivedVols) {
					for (const chunk of vol.chunks) {
						for (const pRaid of chunk.pRaids) {
							for (const ds of pRaid.diskSegments) {
								if (ds.fromReserved) {
									assert.ok(ds.reservedUUID, `Volume ${vol._id} segment should have reservedUUID`);
									assert.ok(reservedUUIDs.has(ds.reservedUUID),
										`Volume ${vol._id} reservedUUID ${ds.reservedUUID} should reference an existing reserved segment`);
								}
							}
						}
					}
				}
			});
		});

		it('reclaimUUIDMap should be cleared from reserved volume', () => {
			return getReservedVolume(VPG_NAME)
				.then(vol => {
					assert.strictEqual(vol.reclaimUUIDMap, undefined, 'reclaimUUIDMap should be cleared');
				});
		});
	});

	describe('RAID-1 - fully used reserved space', () => {
		const VPG_NAME = 'recl_fully_used';
		let vpgUuid, capacityBefore;

		before(() => setup.newSetup()
			.then(() => generateAndSaveTargets(3, 4))
			.then(() => saveVPG(VPG_NAME, 30, consts.RAIDLevel.MIRRORED_RAID_1, { numberOfMirrors: 1 }))
			.then(res => { vpgUuid = res.uuid; })
			.then(() => createVolume(`${VPG_NAME}_v1`, 10, consts.RAIDLevel.MIRRORED_RAID_1, VPG_NAME, { numberOfMirrors: 1 }))
			.then(() => createVolume(`${VPG_NAME}_v2`, 10, consts.RAIDLevel.MIRRORED_RAID_1, VPG_NAME, { numberOfMirrors: 1 }))
			.then(() => createVolume(`${VPG_NAME}_v3`, 10, consts.RAIDLevel.MIRRORED_RAID_1, VPG_NAME, { numberOfMirrors: 1 }))
			// Reclaim once to shrink VPG to exactly the allocated capacity
			.then(() => reclaimVPG(VPG_NAME, vpgUuid))
			.then(() => vpgCollection.findOne({ _id: VPG_NAME }))
			.then(vpg => { capacityBefore = vpg.capacity; })
		);

		it('should return nothing-to-reclaim when all space is used', () => {
			return reclaimVPGRaw(VPG_NAME, vpgUuid)
				.then(res => {
					assert.ok(res.error, 'Should return error when reserved space is fully used');
				});
		});

		it('VPG capacity should be unchanged', () => {
			return vpgCollection.findOne({ _id: VPG_NAME })
				.then(vpg => {
					assert.strictEqual(vpg.capacity, capacityBefore, 'Capacity should not change');
				});
		});
	});

	describe('RAID-1 - zone segmentsInZone updated after reclaim', () => {
		const VPG_NAME = 'recl_zone';
		const VPG_CAPACITY = 30;
		let vpgUuid, segmentsInZoneBefore;
		let lockCollection;

		// Create VPG, allocate no volumes → all reserved segments will be fully removed.
		before(() => setup.newSetup()
			.then(() => {
				lockCollection = app.get('db').collection('lock');
			})
			.then(() => generateAndSaveTargets(3, 4))
			.then(() => saveVPG(VPG_NAME, VPG_CAPACITY, consts.RAIDLevel.MIRRORED_RAID_1, { numberOfMirrors: 1 }))
			.then(res => { vpgUuid = res.uuid; })
			.then(() => {
				return lockCollection.find({}).toArray().then(locks => {
					segmentsInZoneBefore = locks.reduce((sum, l) => sum + (l.segmentsInZone || 0), 0);
				});
			})
		);

		it('should decrease segmentsInZone count after reclaim', () => {
			return reclaimVPG(VPG_NAME, vpgUuid)
				.then(() => lockCollection.find({}).toArray())
				.then(locks => {
					const segmentsInZoneAfter = locks.reduce((sum, l) => sum + (l.segmentsInZone || 0), 0);
					assert.ok(segmentsInZoneAfter < segmentsInZoneBefore,
						`segmentsInZone should decrease: before=${segmentsInZoneBefore}, after=${segmentsInZoneAfter}`);
				});
		});
	});

	describe('RAID-10 with derived volumes - reclaim', () => {
		const VPG_NAME = 'recl_r10';
		const VPG_CAPACITY = 50;
		const RAID_ATTRS = {
			numberOfMirrors: 1,
			stripeSize: consts.DEFAULT_STRIPE_SIZE_BLOCKS,
			stripeWidth: 2
		};
		let vpgUuid;

		before(() => setup.newSetup()
			.then(() => generateAndSaveTargets(3, 4))
			.then(() => saveVPG(VPG_NAME, VPG_CAPACITY, consts.RAIDLevel.STRIPED_AND_MIRRORED_RAID_10, RAID_ATTRS))
			.then(res => { vpgUuid = res.uuid; })
			.then(() => createVolume(`${VPG_NAME}_v1`, 10, consts.RAIDLevel.STRIPED_AND_MIRRORED_RAID_10, VPG_NAME, RAID_ATTRS))
		);

		it('should reclaim unused space', () => {
			return reclaimVPG(VPG_NAME, vpgUuid)
				.then(() => vpgCollection.findOne({ _id: VPG_NAME }))
				.then(vpg => {
					assert.strictEqual(Math.round(vpg.capacity), 10, 'VPG capacity should be 10GB');
				})
				.then(() => getReservedVolume(VPG_NAME))
				.then(vol => {
					assert.ok(vol, 'Reserved volume should still exist');
					assertChunkInvariants(vol);
				});
		});

		it('derived segments should be covered by reserved segments', () => {
			return Promise.all([getReservedDiskSegments(VPG_NAME), getDerivedDiskSegments()])
				.then(([reservedSegs, derivedSegs]) => {
					for (const derived of derivedSegs) {
						const covering = reservedSegs.find(r =>
							r.diskID === derived.diskID && r.lbs <= derived.lbs && r.lbe >= derived.lbe
						);
						assert.ok(covering, `Derived [${derived.lbs}-${derived.lbe}] on ${derived.diskID} not covered`);
					}
				});
		});
	});

	describe('Erasure Coding with derived volumes - reclaim', () => {
		const VPG_NAME = 'recl_ec';
		const VPG_CAPACITY = 50;
		const EC_ATTRS = {
			stripeSize: consts.DEFAULT_STRIPE_SIZE_BLOCKS,
			stripeWidth: 1,
			dataBlocks: 4,
			parityBlocks: 1,
			protectionLevel: consts.separationTypes.FULL
		};
		let vpgUuid;

		before(() => setup.newSetup()
			.then(() => generateAndSaveTargets(10, 4))
			.then(() => saveVPG(VPG_NAME, VPG_CAPACITY, consts.RAIDLevel.ERASURE_CODING, EC_ATTRS))
			.then(res => { vpgUuid = res.uuid; })
			.then(() => createVolume(`${VPG_NAME}_v1`, 10, consts.RAIDLevel.ERASURE_CODING, VPG_NAME, EC_ATTRS))
		);

		it('should reclaim unused space', () => {
			return reclaimVPG(VPG_NAME, vpgUuid)
				.then(() => vpgCollection.findOne({ _id: VPG_NAME }))
				.then(vpg => {
					assert.strictEqual(Math.round(vpg.capacity), 10, 'VPG capacity should be 10GB');
				})
				.then(() => getReservedVolume(VPG_NAME))
				.then(vol => {
					assert.ok(vol, 'Reserved volume should still exist');
					assertChunkInvariants(vol);
				});
		});

		it('derived segments should be covered by reserved segments', () => {
			return Promise.all([getReservedDiskSegments(VPG_NAME), getDerivedDiskSegments()])
				.then(([reservedSegs, derivedSegs]) => {
					for (const derived of derivedSegs) {
						const covering = reservedSegs.find(r =>
							r.diskID === derived.diskID && r.lbs <= derived.lbs && r.lbe >= derived.lbe
						);
						assert.ok(covering, `Derived [${derived.lbs}-${derived.lbe}] on ${derived.diskID} not covered`);
					}
				});
		});
	});

});

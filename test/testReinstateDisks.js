/*
 * SPDX-FileCopyrightText: Copyright (c) 2026 NVIDIA CORPORATION & AFFILIATES. All rights reserved.
 * SPDX-License-Identifier: Apache-2.0
 */

/* global describe,before,it,after */

const assert = require('assert');

const dbManager = require('./testUtils/dbManager.js');
const { setup } = require('./testUtils/setup.js');
const { generateTargets } = require('./testUtils/entityGenerators.js');
const { Volume, VolumeRAID1, VolumeEC, VolumeConcatenated } = require('./models/volume.js');
const { pollUntil, stubMethod } = require('./testUtils/common.js');
const { assertIsCausedBy } = require('./testUtils/errorUtils.js');
const { clearAllQueues } = require('./testUtils/mockKafkaModule.js');
const {
	reportAllSegmentsOnline, getAllVolumeSegments, getSegmentsByStatus,
	sendPRaidReportWithStatuses, sendDeprecationReport,
	assertVolumeStatusAndAction, assertSegmentCount, assertHasSegments
} = require('./testUtils/volumeUtils.js');
const {
	evictDisk, reinstateDisk, evictDiskAndSyncTarget, getDiskFromDB, syncTargetDiskFromDB, findTargetWithDisk
} = require('./testUtils/diskUtils.js');

const consts = require('../consts.js');
const systemMessages = require('../systemMessages.js');
const diskModule = require('../modules/disk.js');
const { reinstateDrives } = require('../modules/disk.js');
const { checkAndResumeStuckReinstate } = require('../modules/sanityAndRecover.js');

const EXPECTED_RAID1_SEGMENT_COUNT = 2;

function runReinstateSanity() {
	return new Promise((resolve, reject) => checkAndResumeStuckReinstate(err => err ? reject(err) : resolve()));
}

async function setupOnlineVolumeWithTargets(volumeName, VolumeClass, targetCount = 3) {
	await setup.newSetup();
	const targets = generateTargets(targetCount, 1);
	await Promise.all(targets.map(t => t.save()));

	const volume = new VolumeClass(volumeName);
	await volume.createOrReject();

	let dbVolume = await Volume.getFromDB(volume.name);
	await reportAllSegmentsOnline(dbVolume, targets[0]);

	dbVolume = await Volume.getFromDB(volume.name);
	return { targets, volume, dbVolume };
}

async function setupReinstateEnvironment(volumeName, VolumeClass = VolumeRAID1, targetCount = 3) {
	const { targets, volume, dbVolume } = await setupOnlineVolumeWithTargets(volumeName, VolumeClass, targetCount);

	const firstSegment = dbVolume.chunks[0].pRaids[0].diskSegments[0];
	await evictDiskAndSyncTarget({ diskID: firstSegment.diskID, uuid: firstSegment.diskUUID }, targets);

	const updatedVolume = await Volume.getFromDB(volume.name);
	return { targets, volume, firstSegment, dbVolume: updatedVolume };
}


describe('Reinstate Disks', () => {
	before(() => dbManager.connect());
	after(() => dbManager.closeConnection());

	describe('#Happy Path - Full end-to-end reinstate flow on RAID1 volume', function() {
		let targets;
		let volume;
		let evictedDiskID;
		let evictedDiskUUID;
		let originalVersionBeforeReinstate;
		let expectedReinstateSegmentCount;

		before(async() => {
			const env = await setupReinstateEnvironment('reinstate-e2e-v1');
			targets = env.targets;
			volume = env.volume;
			evictedDiskID = env.firstSegment.diskID;
			evictedDiskUUID = env.firstSegment.diskUUID;
			originalVersionBeforeReinstate = env.dbVolume.version;
		});

		it('Should create old+pending segment pairs on disk and volume after reinstate', async() => {
			const logs = await reinstateDisk({ _id: evictedDiskID, uuid: evictedDiskUUID });
			assert.strictEqual(logs[0].systemMessage.id, systemMessages.DRIVE_REINSTATED.id, 'Expected DRIVE_REINSTATED message');

			const disk = await getDiskFromDB(evictedDiskID);
			assert.strictEqual(disk.isOutOfService, true, 'Disk should remain isOutOfService after reinstate');

			const oldSegs = getSegmentsByStatus(disk.diskSegments, consts.diskSegmentStatuses.MARKED_FOR_REBUILD_OLD);
			const pendingSegs = getSegmentsByStatus(disk.diskSegments, consts.diskSegmentStatuses.MARKED_FOR_REBUILD_PENDING);
			assert(oldSegs.length > 0, 'Expected markedForRebuild_old segments on disk');
			assert.strictEqual(pendingSegs.length, oldSegs.length, 'Pending and old segment counts should match');
			expectedReinstateSegmentCount = pendingSegs.length;

			pendingSegs.forEach(pending => {
				const matchingOld = oldSegs.find(old => old.lbs === pending.lbs && old.lbe === pending.lbe);
				assert(matchingOld, `Pending segment lbs=${pending.lbs} has no matching old segment`);
				assert.strictEqual(pending.diskUUID, evictedDiskUUID, 'Pending segment should keep evicted diskUUID');
			});

			const dbVolume = await Volume.getFromDB(volume.name);
			assert.strictEqual(dbVolume.version, originalVersionBeforeReinstate + 1, 'Volume version should be bumped by 1');
			assertVolumeStatusAndAction(dbVolume, consts.volumeStatuses.ONLINE, consts.volumeActions.REBUILD_REQUIRED);

			const allVolSegs = getAllVolumeSegments(dbVolume);
			assertSegmentCount(allVolSegs, consts.diskSegmentStatuses.MARKED_FOR_REBUILD_PENDING, pendingSegs.length);
			assertSegmentCount(allVolSegs, consts.diskSegmentStatuses.MARKED_FOR_REBUILD_OLD, oldSegs.length);
		});

		it('Should send HW configuration to TOMA after reinstate', async() => {
			const hwMsg = await targets[0].readMessageFromHWConfigTopic();
			assert(hwMsg, 'Expected HardwareConfiguration message sent to TOMA');
			assert.strictEqual(hwMsg.type, consts.kafkaMessageTypes.ManagementToTOMA.hardwareConfiguration);
		});

		it('Should send UpdateVolume to TOMA with fake UUID for pending segments', async() => {
			const tomaMsg = await targets[0].readMessageFromIncrementalUpdatesTopic();
			assert.strictEqual(tomaMsg.type, consts.kafkaMessageTypes.ManagementToTOMA.updateVolume);

			const tomaSegments = getAllVolumeSegments(tomaMsg.payload);
			assertSegmentCount(tomaSegments, consts.diskSegmentStatuses.MARKED_FOR_REBUILD_PENDING, expectedReinstateSegmentCount);
			getSegmentsByStatus(tomaSegments, consts.diskSegmentStatuses.MARKED_FOR_REBUILD_PENDING).forEach(seg => {
				assert.strictEqual(seg.diskUUID, consts.REINSTATE_FAKE_DRIVE_UUID, `TOMA should see fake UUID, got ${seg.diskUUID}`);
			});
		});

		it('Should remove old segments and keep pending after TOMA deprecation report', async() => {
			let dbVolume = await Volume.getFromDB(volume.name);
			const oldSegments = getSegmentsByStatus(getAllVolumeSegments(dbVolume), consts.diskSegmentStatuses.MARKED_FOR_REBUILD_OLD);

			await sendDeprecationReport(dbVolume, oldSegments, targets[0]);

			dbVolume = await Volume.getFromDB(volume.name);
			const segsAfterDeprecation = getAllVolumeSegments(dbVolume);
			assertSegmentCount(segsAfterDeprecation, consts.diskSegmentStatuses.MARKED_FOR_REBUILD_OLD, 0);
			assertSegmentCount(segsAfterDeprecation, consts.diskSegmentStatuses.MARKED_FOR_REBUILD_PENDING, expectedReinstateSegmentCount);
			assertVolumeStatusAndAction(dbVolume, consts.volumeStatuses.ONLINE, consts.volumeActions.REBUILD_REQUIRED);

			const tomaMsg = await targets[0].readMessageFromIncrementalUpdatesTopic();
			assert.strictEqual(tomaMsg.type, consts.kafkaMessageTypes.ManagementToTOMA.updateVolume);

			const tomaSegments = getAllVolumeSegments(tomaMsg.payload);
			assertSegmentCount(tomaSegments, consts.diskSegmentStatuses.MARKED_FOR_REBUILD_OLD, 0);
			assertSegmentCount(tomaSegments, consts.diskSegmentStatuses.MARKED_FOR_REBUILD_PENDING, expectedReinstateSegmentCount);
			getSegmentsByStatus(tomaSegments, consts.diskSegmentStatuses.MARKED_FOR_REBUILD_PENDING).forEach(seg => {
				assert.strictEqual(seg.diskUUID, consts.REINSTATE_FAKE_DRIVE_UUID, 'Pending should still have fake UUID');
			});
		});

		it('Should auto-trigger formatDrive command to TOMA after all old segments deprecated', async() => {
			const formatMsg = await targets[0].readMessageFromCommandsTopic();
			assert.strictEqual(formatMsg.type, consts.kafkaMessageTypes.ManagementToTOMA.formatDrive);

			const disk = await getDiskFromDB(evictedDiskID);
			assertSegmentCount(disk.diskSegments, consts.diskSegmentStatuses.MARKED_FOR_REBUILD_OLD, 0);
		});

		it('Should replace pending segments with markedForRebuild after format completes', async function() {
			this.timeout(10000);

			await syncTargetDiskFromDB(targets[0], evictedDiskID, true);
			targets[0].messageSequence += 1;
			await targets[0].sendReport();

			await pollUntil(async() => {
				const vol = await Volume.getFromDB(volume.name);
				const segs = getAllVolumeSegments(vol);
				return !segs.some(s => s.status === consts.diskSegmentStatuses.MARKED_FOR_REBUILD_PENDING)
					&& segs.some(s => s.status === consts.diskSegmentStatuses.MARKED_FOR_REBUILD);
			});

			const dbVolume = await Volume.getFromDB(volume.name);
			const segsAfterResume = getAllVolumeSegments(dbVolume);

			assertSegmentCount(segsAfterResume, consts.diskSegmentStatuses.MARKED_FOR_REBUILD_PENDING, 0);
			assertSegmentCount(segsAfterResume, consts.diskSegmentStatuses.MARKED_FOR_REBUILD, expectedReinstateSegmentCount);

			getSegmentsByStatus(segsAfterResume, consts.diskSegmentStatuses.MARKED_FOR_REBUILD).forEach(seg => {
				assert.notStrictEqual(seg.diskUUID, evictedDiskUUID, 'Should have new post-format diskUUID');
			});

			const disk = await getDiskFromDB(evictedDiskID);
			assert.strictEqual(disk.isOutOfService, false, 'Disk should not be isOutOfService after format');
			assertVolumeStatusAndAction(dbVolume, consts.volumeStatuses.DEGRADED, consts.volumeActions.MARKED_FOR_REBUILD);
		});

		it('Should send UpdateVolume to TOMA with real UUID after second replacement', async() => {
			const tomaMsg = await targets[0].readMessageFromIncrementalUpdatesTopic();
			assert.strictEqual(tomaMsg.type, consts.kafkaMessageTypes.ManagementToTOMA.updateVolume);
			assertSegmentCount(getAllVolumeSegments(tomaMsg.payload), consts.diskSegmentStatuses.MARKED_FOR_REBUILD_PENDING, 0);
		});

		it('Should transition to markedForRebuild after TOMA reports replacement and deprecation', async() => {
			let dbVolume = await Volume.getFromDB(volume.name);

			await sendPRaidReportWithStatuses(dbVolume, seg => {
				if (seg.status === consts.diskSegmentStatuses.MARKED_FOR_REBUILD) return consts.diskSegmentStatuses.REPLACEMENT;
				if (seg.status === consts.diskSegmentStatuses.MARKED_FOR_REBUILD_OLD) return consts.diskSegmentStatuses.DEPRECATED;
				return seg.status;
			}, targets[0]);

			dbVolume = await Volume.getFromDB(volume.name);
			assertSegmentCount(getAllVolumeSegments(dbVolume), consts.diskSegmentStatuses.MARKED_FOR_REBUILD_OLD, 0);
			assertVolumeStatusAndAction(dbVolume, consts.volumeStatuses.DEGRADED, consts.volumeActions.MARKED_FOR_REBUILD);
		});

		it('Should transition to rebuilding after TOMA reports under_recovery', async() => {
			let dbVolume = await Volume.getFromDB(volume.name);

			await sendPRaidReportWithStatuses(dbVolume, seg => {
				if (seg.status === consts.diskSegmentStatuses.MARKED_FOR_REBUILD) return consts.diskSegmentStatuses.UNDER_RECOVERY_TOMA;
				return consts.diskSegmentStatuses.NORMAL;
			}, targets[0]);

			dbVolume = await Volume.getFromDB(volume.name);
			assertVolumeStatusAndAction(dbVolume, consts.volumeStatuses.DEGRADED, consts.volumeActions.REBUILDING);
		});

		it('Should return to online-none after TOMA reports all segments normal', async() => {
			let dbVolume = await Volume.getFromDB(volume.name);

			await sendPRaidReportWithStatuses(dbVolume, () => consts.diskSegmentStatuses.NORMAL, targets[0]);

			dbVolume = await Volume.getFromDB(volume.name);
			assertVolumeStatusAndAction(dbVolume, consts.volumeStatuses.ONLINE, consts.volumeActions.NONE);

			const finalSegs = getAllVolumeSegments(dbVolume);
			assertSegmentCount(finalSegs, consts.diskSegmentStatuses.MARKED_FOR_REBUILD_PENDING, 0);
			assertSegmentCount(finalSegs, consts.diskSegmentStatuses.MARKED_FOR_REBUILD_OLD, 0);
			assertSegmentCount(finalSegs, consts.diskSegmentStatuses.MARKED_FOR_REBUILD, 0);
			assert.strictEqual(finalSegs.length, EXPECTED_RAID1_SEGMENT_COUNT);
		});
	});

	describe('#Validation and Rejection', function() {
		let targets;
		let volume;

		before(async() => {
			const env = await setupOnlineVolumeWithTargets('rstValidV1', VolumeRAID1);
			targets = env.targets;
			volume = env.volume;
		});

		it('Should reject reinstate on a non-evicted disk', async() => {
			const dbVolume = await Volume.getFromDB(volume.name);
			const seg = dbVolume.chunks[0].pRaids[0].diskSegments[0];

			const logs = await reinstateDisk({ _id: seg.diskID, uuid: seg.diskUUID });
			assertIsCausedBy(logs[0], systemMessages.DRIVE_REINSTATE_NOT_OUT_OF_SERVICE);
		});

		it('Should reject reinstate if disk not found', async() => {
			const logs = await reinstateDisk({ _id: 'NON_EXISTENT_DISK', uuid: 'fake-uuid' });
			assertIsCausedBy(logs[0], systemMessages.DRIVE_NOT_FOUND);
		});

		it('Should reject reinstate on a disk with unprotected (JBOD) segments', async() => {
			const jbodVolume = new VolumeConcatenated('rstValidJbod');
			await jbodVolume.createOrReject();

			let dbVolume = await Volume.getFromDB(jbodVolume.name);
			await reportAllSegmentsOnline(dbVolume, targets[0]);

			dbVolume = await Volume.getFromDB(jbodVolume.name);
			const seg = dbVolume.chunks[0].pRaids[0].diskSegments[0];

			await evictDisk({ diskID: seg.diskID, uuid: seg.diskUUID }, true);

			const logs = await reinstateDisk({ _id: seg.diskID, uuid: seg.diskUUID });
			assertIsCausedBy(logs[0], systemMessages.DRIVE_REINSTATE_NON_PROTECTED_SEGMENTS);
		});
	});

	describe('#Format Validation During Reinstate', function() {
		let targets;
		let evictedDiskID;
		let evictedDiskUUID;

		before(async() => {
			const env = await setupReinstateEnvironment('rstFormatV1');
			targets = env.targets;
			evictedDiskID = env.firstSegment.diskID;
			evictedDiskUUID = env.firstSegment.diskUUID;

			const logs = await reinstateDisk({ _id: evictedDiskID, uuid: evictedDiskUUID });
			assert.strictEqual(logs[0].systemMessage.id, systemMessages.DRIVE_REINSTATED.id, 'Reinstate should succeed');
		});

		it('Should block format when old and pending segments coexist', async() => {
			const diskToFormat = [{ _id: evictedDiskID, uuid: evictedDiskUUID }];
			const logs = await new Promise(resolve => diskModule.formatDiskByIDsAndUUIDs(diskToFormat, null, false, resolve));
			assertIsCausedBy(logs[0], systemMessages.DRIVE_REINSTATE_IN_PROGRESS);
		});

		it('Should allow format when only pending segments remain', async() => {
			let dbVolume = await Volume.getFromDB('rstFormatV1');
			const oldSegments = getAllVolumeSegments(dbVolume).filter(s => s.status === consts.diskSegmentStatuses.MARKED_FOR_REBUILD_OLD);
			await sendDeprecationReport(dbVolume, oldSegments, targets[0]);

			const formatMsg = await targets[0].readMessageFromCommandsTopic();
			assert.strictEqual(formatMsg.type, consts.kafkaMessageTypes.ManagementToTOMA.formatDrive);
		});
	});

	describe('#Sanity and Recovery', function() {
		it('Should do nothing when no pending segments exist', async() => {
			await setup.newSetup();
			const targets = generateTargets(3, 1);
			await Promise.all(targets.map(t => t.save()));
			await runReinstateSanity();
		});

		it('Should complete volume update when pending segments exist on disk but not in volume', async() => {
			const { volume, firstSegment } = await setupReinstateEnvironment('rstSanOrpV1');

			const restore = stubMethod('../../modules/disk.js', 'updateVolumesAfterReinstate', (pairs, cb) => cb(new Error('simulated crash')));
			await reinstateDisk({ _id: firstSegment.diskID, uuid: firstSegment.diskUUID });
			restore();

			const disk = await getDiskFromDB(firstSegment.diskID);
			assertHasSegments(disk.diskSegments, consts.diskSegmentStatuses.MARKED_FOR_REBUILD_PENDING);

			let dbVolume = await Volume.getFromDB(volume.name);
			assertSegmentCount(getAllVolumeSegments(dbVolume), consts.diskSegmentStatuses.MARKED_FOR_REBUILD_PENDING, 0);

			await runReinstateSanity();

			dbVolume = await Volume.getFromDB(volume.name);
			assertHasSegments(getAllVolumeSegments(dbVolume), consts.diskSegmentStatuses.MARKED_FOR_REBUILD_PENDING);
		});

		it('Should auto-trigger format when OOS disk has only pending segments', async() => {
			const { targets, volume, firstSegment } = await setupReinstateEnvironment('rstSanFmV1');

			const logs = await reinstateDisk({ _id: firstSegment.diskID, uuid: firstSegment.diskUUID });
			assert.strictEqual(logs[0].systemMessage.id, systemMessages.DRIVE_REINSTATED.id);

			const evictTarget = findTargetWithDisk(targets, firstSegment.diskID);
			await evictTarget.clearQueues();

			let dbVolume = await Volume.getFromDB(volume.name);
			const oldSegments = getAllVolumeSegments(dbVolume).filter(s => s.status === consts.diskSegmentStatuses.MARKED_FOR_REBUILD_OLD);

			const restore = stubMethod('../../modules/disk.js', 'formatDiskByIDsAndUUIDs', (disks, type, isAuto, cb) => cb([]));
			await sendDeprecationReport(dbVolume, oldSegments, evictTarget);
			restore();

			const disk = await getDiskFromDB(firstSegment.diskID);
			assert.strictEqual(disk.isOutOfService, true, 'Disk should be OOS');
			assertHasSegments(disk.diskSegments, consts.diskSegmentStatuses.MARKED_FOR_REBUILD_PENDING);

			clearAllQueues();
			await runReinstateSanity();

			const formatMsg = await evictTarget.readMessageFromCommandsTopic();
			assert.strictEqual(formatMsg.type, consts.kafkaMessageTypes.ManagementToTOMA.formatDrive, 'Sanity should auto-trigger format');
		});

		it('Should resume reinstate when formatted disk still has pending segments', async function() {
			this.timeout(15000);

			const { targets, volume, firstSegment } = await setupReinstateEnvironment('rstSanResV1');
			const evictTarget = findTargetWithDisk(targets, firstSegment.diskID);

			const restore = stubMethod('../../modules/disk.js', 'resumeReinstateAfterFormat', () => {});

			const logs = await reinstateDisk({ _id: firstSegment.diskID, uuid: firstSegment.diskUUID });
			assert.strictEqual(logs[0].systemMessage.id, systemMessages.DRIVE_REINSTATED.id);

			await evictTarget.clearQueues();

			let dbVolume = await Volume.getFromDB(volume.name);
			const oldSegments = getAllVolumeSegments(dbVolume).filter(s => s.status === consts.diskSegmentStatuses.MARKED_FOR_REBUILD_OLD);
			await sendDeprecationReport(dbVolume, oldSegments, evictTarget);

			const formatMsg = await evictTarget.readMessageFromCommandsTopic();
			assert.strictEqual(formatMsg.type, consts.kafkaMessageTypes.ManagementToTOMA.formatDrive);

			await syncTargetDiskFromDB(evictTarget, firstSegment.diskID, true);
			evictTarget.messageSequence += 1;
			await evictTarget.sendReport();

			await pollUntil(async() => {
				const d = await getDiskFromDB(firstSegment.diskID);
				return d && !d.isOutOfService;
			});

			assertHasSegments((await getDiskFromDB(firstSegment.diskID)).diskSegments, consts.diskSegmentStatuses.MARKED_FOR_REBUILD_PENDING);

			restore();
			await runReinstateSanity();

			await pollUntil(async() => {
				const vol = await Volume.getFromDB(volume.name);
				return !getAllVolumeSegments(vol).some(s => s.status === consts.diskSegmentStatuses.MARKED_FOR_REBUILD_PENDING);
			});

			dbVolume = await Volume.getFromDB(volume.name);
			const finalSegs = getAllVolumeSegments(dbVolume);
			assertSegmentCount(finalSegs, consts.diskSegmentStatuses.MARKED_FOR_REBUILD_PENDING, 0);
			assertHasSegments(finalSegs, consts.diskSegmentStatuses.MARKED_FOR_REBUILD);
		});
	});

	describe('#Multi-Disk Reinstate on EC volume', function() {
		let targets;
		let volume;
		let disk1ID, disk1UUID, disk2ID, disk2UUID;

		before(async() => {
			const env = await setupOnlineVolumeWithTargets('rstMultiEcV1', VolumeEC, 12);
			targets = env.targets;
			volume = env.volume;

			const segments = env.dbVolume.chunks[0].pRaids[0].diskSegments;
			disk1ID = segments[0].diskID;
			disk1UUID = segments[0].diskUUID;
			disk2ID = segments[1].diskID;
			disk2UUID = segments[1].diskUUID;
		});

		it('Should reinstate multiple EC disks and accumulate pending segments in volume', async() => {
			await evictDisk({ diskID: disk1ID, uuid: disk1UUID });
			await evictDisk({ diskID: disk2ID, uuid: disk2UUID });

			const target1 = findTargetWithDisk(targets, disk1ID);
			const target2 = findTargetWithDisk(targets, disk2ID);

			clearAllQueues();
			await syncTargetDiskFromDB(target1, disk1ID);
			target1.messageSequence += 1;
			await target1.sendKeepAlive();
			await target1.sendReport();

			if (target1 !== target2) {
				await syncTargetDiskFromDB(target2, disk2ID);
				target2.messageSequence += 1;
				await target2.sendKeepAlive();
				await target2.sendReport();
			}

			const logs = await new Promise(resolve => {
				reinstateDrives([
					{ _id: disk1ID, uuid: disk1UUID },
					{ _id: disk2ID, uuid: disk2UUID }
				], resolve);
			});

			assert.strictEqual(logs.length, 2);
			assert.strictEqual(logs[0].systemMessage.id, systemMessages.DRIVE_REINSTATED.id);
			assert.strictEqual(logs[1].systemMessage.id, systemMessages.DRIVE_REINSTATED.id);

			const disk1 = await getDiskFromDB(disk1ID);
			const disk2 = await getDiskFromDB(disk2ID);
			assertHasSegments(disk1.diskSegments, consts.diskSegmentStatuses.MARKED_FOR_REBUILD_PENDING);
			assertHasSegments(disk2.diskSegments, consts.diskSegmentStatuses.MARKED_FOR_REBUILD_PENDING);

			const disk1PendingCount = getSegmentsByStatus(disk1.diskSegments, consts.diskSegmentStatuses.MARKED_FOR_REBUILD_PENDING).length;
			const disk2PendingCount = getSegmentsByStatus(disk2.diskSegments, consts.diskSegmentStatuses.MARKED_FOR_REBUILD_PENDING).length;

			const dbVolume = await Volume.getFromDB(volume.name);
			const allPending = getSegmentsByStatus(getAllVolumeSegments(dbVolume), consts.diskSegmentStatuses.MARKED_FOR_REBUILD_PENDING);
			assert.strictEqual(allPending.length, disk1PendingCount + disk2PendingCount,
				'Volume should accumulate pending segments from both disks');

			assertVolumeStatusAndAction(dbVolume, consts.volumeStatuses.ONLINE, consts.volumeActions.REBUILD_REQUIRED);
		});
	});
});

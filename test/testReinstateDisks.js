/*
 * SPDX-FileCopyrightText: Copyright (c) 2026 NVIDIA CORPORATION & AFFILIATES. All rights reserved.
 * SPDX-License-Identifier: Apache-2.0
 */

/* global describe,before,it,after */

const assert = require('assert');

const dbManager = require('./testUtils/dbManager.js');
const { setup } = require('./testUtils/setup.js');
const { generateTargets } = require('./testUtils/entityGenerators.js');
const { Volume, VolumeRAID1, VolumeEC, VolumeConcatenated, VolumeVPG } = require('./models/volume.js');
const { pollUntil, stubMethod } = require('./testUtils/common.js');
const { assertIsCausedBy } = require('./testUtils/errorUtils.js');
const { clearAllQueues } = require('./testUtils/mockKafkaModule.js');
const {
	reportAllSegmentsOnline, getAllVolumeSegments, getSegmentsByStatus,
	sendPRaidReportWithStatuses, sendDeprecationReport,
	assertVolumeStatusAndAction, assertSegmentCount, assertHasSegments,
	assertFakeDriveSegmentsOnWire, assertUniqueSegmentUUIDsPerPRaid
} = require('./testUtils/volumeUtils.js');
const {
	evictDisk, reinstateDisks, evictDiskAndSyncTarget, getDiskFromDB, syncTargetDiskFromDB, findTargetWithDisk
} = require('./testUtils/diskUtils.js');

const consts = require('../consts.js');
const systemMessages = require('../systemMessages.js');
const diskModule = require('../modules/disk.js');
const { checkAndResumeStuckReinstate } = require('../modules/sanityAndRecover.js');
const { startVolumesRebuild } = require('../utils.js');
const { saveVPG } = require('./testUtils/vpgUtils.js');

const EXPECTED_RAID1_SEGMENT_COUNT = 2;

function runReinstateSanity() {
	return new Promise((resolve, reject) => checkAndResumeStuckReinstate(err => err ? reject(err) : resolve()));
}

async function setupOnlineVolumeWithTargets(volumeName, VolumeClass, targetCount = 3, { beforeCreate, createVolume } = {}) {
	await setup.newSetup();
	const targets = generateTargets(targetCount, 1);
	targets.forEach(t => t.populateMetadataPartitionsOnDisks());
	await Promise.all(targets.map(t => t.save()));

	if (beforeCreate)
		await beforeCreate();

	const volume = createVolume ? createVolume(volumeName) : new VolumeClass(volumeName);
	await volume.createOrReject();

	let dbVolume = await Volume.getFromDB(volume.name);
	await reportAllSegmentsOnline(dbVolume, targets[0]);

	dbVolume = await Volume.getFromDB(volume.name);
	return { targets, volume, dbVolume };
}

async function setupReinstateEnvironment(volumeName, VolumeClass = VolumeRAID1, targetCount = 3, options = {}) {
	const { targets, volume, dbVolume } = await setupOnlineVolumeWithTargets(volumeName, VolumeClass, targetCount, options);

	const firstSegment = dbVolume.chunks[0].pRaids[0].diskSegments[0];
	await evictDiskAndSyncTarget({ diskID: firstSegment.diskID, uuid: firstSegment.diskUUID }, targets);

	const updatedVolume = await Volume.getFromDB(volume.name);
	return { targets, volume, firstSegment, dbVolume: updatedVolume };
}

async function setupVPGReinstateEnvironment(vpgName, derivedVolName) {
	const { targets, volume, firstSegment } = await setupReinstateEnvironment(derivedVolName, null, 2, {
		beforeCreate: () => saveVPG(vpgName, 50, consts.RAIDLevel.MIRRORED_RAID_1, { numberOfMirrors: 1 }),
		createVolume: name => new VolumeVPG(name, 10, vpgName)
	});
	const evictTarget = findTargetWithDisk(targets, firstSegment.diskID);
	return { targets, volume, evictTarget, reservedSegDiskID: firstSegment.diskID, reservedSegDiskUUID: firstSegment.diskUUID };
}

describe('Reinstate Disks', () => {
	const originalAutoFormatDelay = consts.AUTO_FORMAT_DELAY;

	before(() => {
		// Zero the auto-format delay so mock Kafka reads don't time out waiting for the delayed command.
		consts.AUTO_FORMAT_DELAY = 0;
		return dbManager.connect();
	});

	after(() => {
		consts.AUTO_FORMAT_DELAY = originalAutoFormatDelay;
		return dbManager.closeConnection();
	});

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
			const logs = await reinstateDisks([{ diskID: evictedDiskID, uuid: evictedDiskUUID }]);
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
				assert.notStrictEqual(pending._id, matchingOld._id, 'Reinstate twin must have a fresh _id distinct from its old partner');
				assert.notStrictEqual(pending.uuid, matchingOld.uuid, 'Reinstate twin must have a fresh uuid distinct from its old partner');
			});

			const dbVolume = await Volume.getFromDB(volume.name);
			assert.strictEqual(dbVolume.version, originalVersionBeforeReinstate + 1, 'Volume version should be bumped by 1');
			assertVolumeStatusAndAction(dbVolume, consts.volumeStatuses.DEGRADED, consts.volumeActions.REBUILD_REQUIRED);

			const allVolSegs = getAllVolumeSegments(dbVolume);
			assertSegmentCount(allVolSegs, consts.diskSegmentStatuses.MARKED_FOR_REBUILD_PENDING, pendingSegs.length);
			assertSegmentCount(allVolSegs, consts.diskSegmentStatuses.MARKED_FOR_REBUILD_OLD, oldSegs.length);
		});

		it('Should send HW configuration to TOMA after reinstate', async() => {
			const hwMsg = await targets[0].readMessageFromHWConfigTopic();
			assert(hwMsg, 'Expected HardwareConfiguration message sent to TOMA');
			assert.strictEqual(hwMsg.type, consts.kafkaMessageTypes.ManagementToTOMA.hardwareConfiguration);
		});

		it('Should send UpdateVolume to TOMA with fake UUID and markedForRebuild status for pending segments', async() => {
			const tomaMsg = await targets[0].readMessageFromIncrementalUpdatesTopic();
			assert.strictEqual(tomaMsg.type, consts.kafkaMessageTypes.ManagementToTOMA.updateVolume);

			const tomaSegments = getAllVolumeSegments(tomaMsg.payload);
			assertSegmentCount(tomaSegments, consts.diskSegmentStatuses.MARKED_FOR_REBUILD_PENDING, 0);
			assertFakeDriveSegmentsOnWire(tomaSegments, expectedReinstateSegmentCount);
			assertUniqueSegmentUUIDsPerPRaid(tomaMsg.payload);

			const dbVolume = await Volume.getFromDB(volume.name);
			assertSegmentCount(getAllVolumeSegments(dbVolume), consts.diskSegmentStatuses.MARKED_FOR_REBUILD_PENDING, expectedReinstateSegmentCount);
		});

		it('Should remove old segments and keep pending after TOMA deprecation report', async() => {
			let dbVolume = await Volume.getFromDB(volume.name);
			const oldSegments = getSegmentsByStatus(getAllVolumeSegments(dbVolume), consts.diskSegmentStatuses.MARKED_FOR_REBUILD_OLD);

			await sendDeprecationReport(dbVolume, oldSegments, targets[0]);

			dbVolume = await Volume.getFromDB(volume.name);
			const segsAfterDeprecation = getAllVolumeSegments(dbVolume);
			assertSegmentCount(segsAfterDeprecation, consts.diskSegmentStatuses.MARKED_FOR_REBUILD_OLD, 0);
			assertSegmentCount(segsAfterDeprecation, consts.diskSegmentStatuses.MARKED_FOR_REBUILD_PENDING, expectedReinstateSegmentCount);
			assertVolumeStatusAndAction(dbVolume, consts.volumeStatuses.DEGRADED, consts.volumeActions.REBUILD_REQUIRED);

			const tomaMsg = await targets[0].readMessageFromIncrementalUpdatesTopic();
			assert.strictEqual(tomaMsg.type, consts.kafkaMessageTypes.ManagementToTOMA.updateVolume);

			const tomaSegments = getAllVolumeSegments(tomaMsg.payload);
			assertSegmentCount(tomaSegments, consts.diskSegmentStatuses.MARKED_FOR_REBUILD_OLD, 0);
			assertSegmentCount(tomaSegments, consts.diskSegmentStatuses.MARKED_FOR_REBUILD_PENDING, 0);
			assertFakeDriveSegmentsOnWire(tomaSegments, expectedReinstateSegmentCount);
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

			assertUniqueSegmentUUIDsPerPRaid(tomaMsg.payload, 'after second replacement: ');
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

			const logs = await reinstateDisks([{ diskID: seg.diskID, uuid: seg.diskUUID }]);
			assertIsCausedBy(logs[0], systemMessages.DRIVE_REINSTATE_NOT_OUT_OF_SERVICE);
		});

		it('Should reject reinstate if disk not found', async() => {
			const logs = await reinstateDisks([{ diskID: 'NON_EXISTENT_DISK', uuid: 'fake-uuid' }]);
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

			const logs = await reinstateDisks([{ diskID: seg.diskID, uuid: seg.diskUUID }]);
			assertIsCausedBy(logs[0], systemMessages.DRIVE_REINSTATE_NON_PROTECTED_SEGMENTS);
		});
	});

	describe('#Rebuild in progress', function() {
		let rebuildTargets;
		let evictedDiskID;
		let evictedDiskUUID;

		before(async() => {
			await setup.newSetup();
			rebuildTargets = generateTargets(3, 1);
			rebuildTargets.forEach(t => t.populateMetadataPartitionsOnDisks());
			await Promise.all(rebuildTargets.map(t => t.save()));

			const volumeWithRebuild = new VolumeRAID1('rstMfroVol1');
			await volumeWithRebuild.createOrReject();

			const volumeWithoutRebuild = new VolumeRAID1('rstMfroVol2');
			await volumeWithoutRebuild.createOrReject();

			let dbVolumeWithRebuild = await Volume.getFromDB(volumeWithRebuild.name);
			const dbVolumeWithoutRebuild = await Volume.getFromDB(volumeWithoutRebuild.name);

			await reportAllSegmentsOnline(dbVolumeWithRebuild, rebuildTargets[0]);
			await reportAllSegmentsOnline(dbVolumeWithoutRebuild, rebuildTargets[0]);

			const firstSegment = dbVolumeWithRebuild.chunks[0].pRaids[0].diskSegments[0];
			evictedDiskID = firstSegment.diskID;
			evictedDiskUUID = firstSegment.diskUUID;

			await evictDiskAndSyncTarget({ diskID: evictedDiskID, uuid: evictedDiskUUID }, rebuildTargets);

			// Trigger rebuild to simulate VPG/diskClass autorebuild — this places markedForRebuild_old on the evicted disk
			dbVolumeWithRebuild = await Volume.getFromDB(volumeWithRebuild.name);
			await new Promise(resolve => startVolumesRebuild([dbVolumeWithRebuild], consts.ADMIN_USER, null, resolve));
		});

		it('Should have markedForRebuild_old segment in volume collection after rebuild', async() => {
			const dbVolume = await Volume.getFromDB('rstMfroVol1');
			const allSegs = getAllVolumeSegments(dbVolume);
			assertHasSegments(allSegs, consts.diskSegmentStatuses.MARKED_FOR_REBUILD_OLD);
			const markedForRebuildOldSeg = getSegmentsByStatus(allSegs, consts.diskSegmentStatuses.MARKED_FOR_REBUILD_OLD)[0];
			assert.strictEqual(markedForRebuildOldSeg.diskID, evictedDiskID, 'markedForRebuild_old segment should be on the evicted disk');
		});

		it('Should reject reinstate while a markedForRebuild_old segment exists on the disk in any volume', async() => {
			const logs = await reinstateDisks([{ diskID: evictedDiskID, uuid: evictedDiskUUID }]);
			assertIsCausedBy(logs[0], systemMessages.DRIVE_REINSTATE_REBUILD_IN_PROGRESS);
		});

		it('Should allow reinstate after the markedForRebuild_old segment is deprecated', async() => {
			let dbVolume = await Volume.getFromDB('rstMfroVol1');
			const markedForRebuildOldSegments = getSegmentsByStatus(getAllVolumeSegments(dbVolume), consts.diskSegmentStatuses.MARKED_FOR_REBUILD_OLD);
			await sendDeprecationReport(dbVolume, markedForRebuildOldSegments, rebuildTargets[0]);

			const logs = await reinstateDisks([{ diskID: evictedDiskID, uuid: evictedDiskUUID }]);
			assert.strictEqual(logs[0].systemMessage.id, systemMessages.DRIVE_REINSTATED.id,
				'Expected DRIVE_REINSTATED after markedForRebuild_old is cleared');
		});
	});

	describe('#Only-reserved disk reinstate', function() {
		const VPG_NAME = 'rstOnlyReservedVpg';
		let target, diskID, diskUUID;

		before(async() => {
			await setup.newSetup();
			const targets = generateTargets(2, 1);
			targets.forEach(t => t.populateMetadataPartitionsOnDisks());
			await Promise.all(targets.map(t => t.save()));

			await saveVPG(VPG_NAME, 50, consts.RAIDLevel.MIRRORED_RAID_1, { numberOfMirrors: 1 });

			const reservedVol = await Volume.getFromDB(VPG_NAME);
			const firstSeg = reservedVol.chunks[0].pRaids[0].diskSegments[0];
			diskID = firstSeg.diskID;
			diskUUID = firstSeg.diskUUID;
			target = findTargetWithDisk(targets, diskID);

			await evictDisk({ diskID, uuid: diskUUID });
			await target.clearQueues();
		});

		it('Should reinstate and immediately auto-trigger format — no OLD segments, no TOMA deprecation needed', async() => {
			const logs = await reinstateDisks([{ diskID, uuid: diskUUID }]);
			assert.strictEqual(logs[0].systemMessage.id, systemMessages.DRIVE_REINSTATED.id, 'Reinstate should succeed');

			const formatMsg = await target.readMessageFromCommandsTopic();
			assert.strictEqual(formatMsg?.type, consts.kafkaMessageTypes.ManagementToTOMA.formatDrive, 'Format should auto-trigger immediately');
		});

		it('Should complete post-format replacement and bring disk back online', async function() {
			this.timeout(10000);

			await syncTargetDiskFromDB(target, diskID, true);
			target.messageSequence += 1;
			await target.sendReport();

			await pollUntil(async() => {
				const disk = await getDiskFromDB(diskID);
				const reservedSegs = (disk?.diskSegments || []).filter(s => s.isReserved && s.type === consts.segmentTypes.DATA);
				return disk && !disk.isOutOfService && reservedSegs.length > 0 &&
					reservedSegs.every(s => s.status === consts.diskSegmentStatuses.NORMAL);
			});

			const disk = await getDiskFromDB(diskID);
			assert.strictEqual(disk.isOutOfService, false, 'Disk should be back online after format');

			const reservedDataSegs = disk.diskSegments.filter(s => s.isReserved && s.type === consts.segmentTypes.DATA);
			assert(reservedDataSegs.length > 0, 'Expected reserved data segments on disk after format');
			assertSegmentCount(reservedDataSegs, consts.diskSegmentStatuses.NORMAL, reservedDataSegs.length);
		});
	});

	describe('#No data segments validation', function() {
		let emptyDisk;

		before(async() => {
			await setup.newSetup();
			const [target] = generateTargets(1, 1);
			target.populateMetadataPartitionsOnDisks();
			await target.save();
			emptyDisk = target.disks[0];
		});

		it('Should reject reinstate on a disk that was never part of a volume', async() => {
			await evictDisk({ diskID: emptyDisk.diskID, uuid: emptyDisk.uuid });

			const logs = await reinstateDisks([{ diskID: emptyDisk.diskID, uuid: emptyDisk.uuid }]);
			assertIsCausedBy(logs[0], systemMessages.DRIVE_REINSTATE_NO_DATA_SEGMENTS);
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

			const logs = await reinstateDisks([{ diskID: evictedDiskID, uuid: evictedDiskUUID }]);
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

			const restore = stubMethod('../../modules/disk.js', 'updateVolumesAfterReinstate', (pairs, reserved, cb) => cb(new Error('simulated crash')));
			await reinstateDisks([{ diskID: firstSegment.diskID, uuid: firstSegment.diskUUID }]);
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

			const logs = await reinstateDisks([{ diskID: firstSegment.diskID, uuid: firstSegment.diskUUID }]);
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

		it('Should defer when format is already in flight on the disk', async() => {
			const { targets, volume, firstSegment } = await setupReinstateEnvironment('rstSanFmtInFlight');

			const logs = await reinstateDisks([{ diskID: firstSegment.diskID, uuid: firstSegment.diskUUID }]);
			assert.strictEqual(logs[0].systemMessage.id, systemMessages.DRIVE_REINSTATED.id);

			const evictTarget = findTargetWithDisk(targets, firstSegment.diskID);
			await evictTarget.clearQueues();

			let dbVolume = await Volume.getFromDB(volume.name);
			const oldSegments = getAllVolumeSegments(dbVolume).filter(s => s.status === consts.diskSegmentStatuses.MARKED_FOR_REBUILD_OLD);
			await sendDeprecationReport(dbVolume, oldSegments, evictTarget);

			const formatMsg = await evictTarget.readMessageFromCommandsTopic();
			assert.strictEqual(formatMsg.type, consts.kafkaMessageTypes.ManagementToTOMA.formatDrive);

			const diskBeforeSanity = await getDiskFromDB(firstSegment.diskID);
			assert(diskBeforeSanity.formatInProgress);
			assert(diskBeforeSanity.isPendingFormat);

			const segmentsBeforeSanity = JSON.stringify(diskBeforeSanity.diskSegments);

			await runReinstateSanity();

			const noNewMsg = await evictTarget.readMessageFromCommandsTopic().catch(() => null);
			assert.strictEqual(noNewMsg, null, 'Sanity must not enqueue another format command while format is in flight');

			const diskAfterSanity = await getDiskFromDB(firstSegment.diskID);
			assert.strictEqual(JSON.stringify(diskAfterSanity.diskSegments), segmentsBeforeSanity);
		});

		it('Should handle incomplete replacement when post-format server update landed but volumes did not', async function() {
			this.timeout(15000);

			const { targets, volume, firstSegment } = await setupReinstateEnvironment('rstSan2ndRep');
			const evictTarget = findTargetWithDisk(targets, firstSegment.diskID);

			const logs = await reinstateDisks([{ diskID: firstSegment.diskID, uuid: firstSegment.diskUUID }]);
			assert.strictEqual(logs[0].systemMessage.id, systemMessages.DRIVE_REINSTATED.id);

			await evictTarget.clearQueues();

			let dbVolume = await Volume.getFromDB(volume.name);
			const oldSegments = getAllVolumeSegments(dbVolume).filter(s => s.status === consts.diskSegmentStatuses.MARKED_FOR_REBUILD_OLD);
			await sendDeprecationReport(dbVolume, oldSegments, evictTarget);

			const formatMsg = await evictTarget.readMessageFromCommandsTopic();
			assert.strictEqual(formatMsg.type, consts.kafkaMessageTypes.ManagementToTOMA.formatDrive);

			const updateVolumesStub = stubMethod('../../modules/disk.js', 'updateVolumesAfterReinstate',
				(pairs, reserved, cb) => cb(new Error('simulated post-format volume crash')));

			await syncTargetDiskFromDB(evictTarget, firstSegment.diskID, true);
			evictTarget.messageSequence += 1;
			await evictTarget.sendReport();

			await pollUntil(async() => {
				const d = await getDiskFromDB(firstSegment.diskID);
				return d && !d.isOutOfService
					&& getSegmentsByStatus(d.diskSegments, consts.diskSegmentStatuses.MARKED_FOR_REBUILD_OLD).length > 0
					&& getSegmentsByStatus(d.diskSegments, consts.diskSegmentStatuses.MARKED_FOR_REBUILD).length > 0;
			});

			updateVolumesStub();

			const disk = await getDiskFromDB(firstSegment.diskID);
			assertHasSegments(disk.diskSegments, consts.diskSegmentStatuses.MARKED_FOR_REBUILD);
			assertHasSegments(disk.diskSegments, consts.diskSegmentStatuses.MARKED_FOR_REBUILD_OLD);

			dbVolume = await Volume.getFromDB(volume.name);
			assertSegmentCount(getAllVolumeSegments(dbVolume), consts.diskSegmentStatuses.MARKED_FOR_REBUILD, 0);

			await runReinstateSanity();

			dbVolume = await Volume.getFromDB(volume.name);
			assertHasSegments(getAllVolumeSegments(dbVolume), consts.diskSegmentStatuses.MARKED_FOR_REBUILD);
		});

		it('Should resume reinstate when formatted disk still has pending segments', async function() {
			this.timeout(150000);

			const { targets, volume, firstSegment } = await setupReinstateEnvironment('rstSanResV1');
			const evictTarget = findTargetWithDisk(targets, firstSegment.diskID);

			const restore = stubMethod('../../modules/disk.js', 'resumeReinstateAfterFormat', () => {});

			const logs = await reinstateDisks([{ diskID: firstSegment.diskID, uuid: firstSegment.diskUUID }]);
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

	describe('#VPG reserved segment sanity recovery', function() {
		const VPG_NAME = 'rstSanVpg';
		const DERIVED_VOL_NAME = `${VPG_NAME}-v1`;
		let evictTarget, derivedVolume, reservedSegDiskID, reservedSegDiskUUID;

		before(async() => {
			({ evictTarget, volume: derivedVolume, reservedSegDiskID, reservedSegDiskUUID } =
				await setupVPGReinstateEnvironment(VPG_NAME, DERIVED_VOL_NAME));
			await evictTarget.clearQueues();
		});

		const getVpgSegsOnReinstatedDisk = (vpg) => getAllVolumeSegments(vpg).filter(s => s.diskID === reservedSegDiskID);

		it('Phase 1 — volume update failed: sanity syncs VPG to PENDING and triggers format', async function() {
			// Phase 1: disk update succeeds (segments → PENDING) but volume update fails
			const restore = stubMethod('../../modules/disk.js', 'updateVolumesAfterReinstate',
				(pairs, reserved, cb) => cb(new Error('simulated phase 1 volume crash')));
			await reinstateDisks([{ diskID: reservedSegDiskID, uuid: reservedSegDiskUUID }]);
			restore();

			// Precondition: VPG segment at REMAP (phase 1 volume update failed)
			const vpgSegsBefore = getVpgSegsOnReinstatedDisk(await Volume.getFromDB(VPG_NAME));
			assert(vpgSegsBefore.length > 0, 'Expected VPG segments on reinstated disk before sanity');
			assertSegmentCount(vpgSegsBefore, consts.diskSegmentStatuses.REMAP, vpgSegsBefore.length);

			// Sanity: reservedVolumeCheck (first) syncs VPG REMAP → PENDING;
			// diskBasedCheck applies missing OLD+PENDING pairs to the derived volume
			await runReinstateSanity();

			const vpgSegsAfterSanity = getVpgSegsOnReinstatedDisk(await Volume.getFromDB(VPG_NAME));
			assert(vpgSegsAfterSanity.length > 0, 'Expected VPG segments on reinstated disk after sanity phase 1');
			assertSegmentCount(vpgSegsAfterSanity, consts.diskSegmentStatuses.MARKED_FOR_REBUILD_PENDING, vpgSegsAfterSanity.length);

			// Deprecate OLD derived-volume segments → format auto-triggers
			const dbDerivedVol = await Volume.getFromDB(derivedVolume.name);
			const derivedVolSegs = getAllVolumeSegments(dbDerivedVol);
			assertHasSegments(derivedVolSegs, consts.diskSegmentStatuses.MARKED_FOR_REBUILD_OLD);

			await evictTarget.clearQueues();
			const oldSegs = getSegmentsByStatus(derivedVolSegs, consts.diskSegmentStatuses.MARKED_FOR_REBUILD_OLD);
			await sendDeprecationReport(dbDerivedVol, oldSegs, evictTarget);

			const formatMsg = await evictTarget.readMessageFromCommandsTopic();
			assert.strictEqual(formatMsg?.type, consts.kafkaMessageTypes.ManagementToTOMA.formatDrive, 'Format should auto-trigger');
		});

		it('Phase 2 — volume update failed: sanity syncs VPG to NORMAL', async function() {
			// Phase 2: disk update succeeds (segment → NORMAL) but volume update fails
			const restore = stubMethod('../../modules/disk.js', 'updateVolumesAfterReinstate',
				(pairs, reserved, cb) => cb(new Error('simulated phase 2 volume crash')));
			await syncTargetDiskFromDB(evictTarget, reservedSegDiskID, true);
			evictTarget.messageSequence += 1;
			await evictTarget.sendReport();

			await pollUntil(async() => {
				const disk = await getDiskFromDB(reservedSegDiskID);
				return disk && !disk.isOutOfService;
			});

			restore();

			// Precondition: VPG segment still at PENDING (phase 2 volume update failed)
			const stuckSegs = getVpgSegsOnReinstatedDisk(await Volume.getFromDB(VPG_NAME));
			assert(stuckSegs.length > 0, 'Expected VPG segments on reinstated disk before sanity phase 2');
			assertSegmentCount(stuckSegs, consts.diskSegmentStatuses.MARKED_FOR_REBUILD_PENDING, stuckSegs.length);

			// Sanity: reservedVolumeCheck syncs VPG PENDING → NORMAL to match disk
			await runReinstateSanity();

			const finalSegs = getVpgSegsOnReinstatedDisk(await Volume.getFromDB(VPG_NAME));
			assert(finalSegs.length > 0, 'Expected VPG segments on reinstated disk after sanity phase 2');
			assertSegmentCount(finalSegs, consts.diskSegmentStatuses.NORMAL, finalSegs.length);
		});
	});

	describe('#VPG reserved-space segment reinstate', function() {
		const VPG_NAME = 'rst-vpg-bug';
		const DERIVED_VOL_NAME = `${VPG_NAME}-v1`;
		let evictTarget, derivedVolume;
		let reservedSegDiskID, reservedSegDiskUUID;

		before(async() => {
			({ evictTarget, volume: derivedVolume, reservedSegDiskID, reservedSegDiskUUID } =
				await setupVPGReinstateEnvironment(VPG_NAME, DERIVED_VOL_NAME));

			const reinstateLogs = await reinstateDisks([{ diskID: reservedSegDiskID, uuid: reservedSegDiskUUID }]);
			assert.strictEqual(reinstateLogs[0].systemMessage.id, systemMessages.DRIVE_REINSTATED.id, 'Reinstate should succeed');
		});

		it('Should NOT create markedForRebuild_old for isReserved segments on disk after reinstate', async() => {
			const disk = await getDiskFromDB(reservedSegDiskID);
			const reservedOldSegs = disk.diskSegments.filter(s => s.isReserved && s.status === consts.diskSegmentStatuses.MARKED_FOR_REBUILD_OLD);
			assert.strictEqual(reservedOldSegs.length, 0, 'Reserved segments must never be marked markedForRebuild_old');
		});

		it('Should not create markedForRebuild_old in the reserved volume doc', async() => {
			const reservedVol = await Volume.getFromDB(VPG_NAME);
			assert(reservedVol, 'Reserved volume document must exist');

			const allSegs = reservedVol.chunks.flatMap(c => c.pRaids.flatMap(p => p.diskSegments));
			assertSegmentCount(allSegs, consts.diskSegmentStatuses.MARKED_FOR_REBUILD_OLD, 0);
		});

		it('Should set VPG volume segment to MARKED_FOR_REBUILD_PENDING after phase 1', async() => {
			const reservedVol = await Volume.getFromDB(VPG_NAME);
			assert(reservedVol, 'Reserved volume document must exist');

			const allSegs = reservedVol.chunks.flatMap(c => c.pRaids.flatMap(p => p.diskSegments));
			const pendingSegs = allSegs.filter(s => s.diskID === reservedSegDiskID &&
				s.status === consts.diskSegmentStatuses.MARKED_FOR_REBUILD_PENDING);
			assert(pendingSegs.length > 0, 'VPG volume segment must be MARKED_FOR_REBUILD_PENDING after phase 1');
		});

		it('Should auto-trigger format after TOMA deprecates derived-volume OLD segments', async() => {
			const dbDerivedVol = await Volume.getFromDB(derivedVolume.name);
			const oldSegs = getSegmentsByStatus(getAllVolumeSegments(dbDerivedVol), consts.diskSegmentStatuses.MARKED_FOR_REBUILD_OLD);
			assert(oldSegs.length > 0, 'Expected OLD segments on derived volume for the evicted disk');

			await evictTarget.clearQueues();
			await sendDeprecationReport(dbDerivedVol, oldSegs, evictTarget);

			const formatMsg = await evictTarget.readMessageFromCommandsTopic();
			assert.strictEqual(formatMsg?.type, consts.kafkaMessageTypes.ManagementToTOMA.formatDrive, 'Format should auto-trigger');
		});

		it('Should set VPG volume segment to NORMAL after phase 2 (format complete)', async function() {
			this.timeout(10000);

			await syncTargetDiskFromDB(evictTarget, reservedSegDiskID, true);
			evictTarget.messageSequence += 1;
			await evictTarget.sendReport();

			let reservedVol;
			await pollUntil(async() => {
				reservedVol = await Volume.getFromDB(VPG_NAME);
				if (!reservedVol) return false;

				const allSegs = reservedVol.chunks.flatMap(c => c.pRaids.flatMap(p => p.diskSegments));
				return allSegs
					.filter(s => s.diskID === reservedSegDiskID)
					.every(s => s.status === consts.diskSegmentStatuses.NORMAL);
			});

			const diskSegs = reservedVol.chunks
				.flatMap(c => c.pRaids.flatMap(p => p.diskSegments))
				.filter(s => s.diskID === reservedSegDiskID);
			assert(diskSegs.length > 0, 'Expected VPG segments on disk after reinstate');
			assertSegmentCount(diskSegs, consts.diskSegmentStatuses.NORMAL, diskSegs.length);
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

			const logs = await reinstateDisks([
				{ diskID: disk1ID, uuid: disk1UUID },
				{ diskID: disk2ID, uuid: disk2UUID }
			]);

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

			assertVolumeStatusAndAction(dbVolume, consts.volumeStatuses.DEGRADED, consts.volumeActions.REBUILD_REQUIRED);
		});
	});

});

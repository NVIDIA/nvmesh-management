/*
 * SPDX-FileCopyrightText: Copyright (c) 2026 NVIDIA CORPORATION & AFFILIATES. All rights reserved.
 * SPDX-License-Identifier: Apache-2.0
 */


const consts = require('../../consts.js');
const assert = require('assert');
const { PRaidReport, SegmentReport, UpdatePRaidReportBuilder } = require('../kafkaMessages/fromTOMA/tomaMessageBuilders.js');
const volumeModule = require('../../modules/volume.js');
const { startVolumeRebuildByIdsAndUUIDs } = require('../../utils.js');
const { syncTargetDiskFromDB, evictDisk } = require('./diskUtils.js');
const { pollUntil } = require('./common.js');
const utils = require('../../utils.js');

exports.validateAllocatedBlocksAgainstCapacity = function(requestedCapacity, blocks, volume) {
	// Actual allocated capacity could be smaller by up to BLOCK_SET_SIZE * BLOCK_SIZE difference

	let blockSetInBytes = consts.BLOCK_SIZE * utils.getVolumeBlockSetSize(volume);
	let blocksCapacityInBytes = blocks * blockSetInBytes;
	let actualDifference = requestedCapacity - blocksCapacityInBytes;
	assert(actualDifference <= blockSetInBytes, 'Volume blocks do not match the expected capacity');
};

exports.generatePRaidReportMessagesByStatusFromVolumes = function(volumes, diskSegmentsStatus) {
	let pRaidsReportsMessages = [];
	let tomaLeaderToPRaidReports = {};

	volumes.forEach(volume => {
		volume.chunks.forEach(chunk => {
			chunk.pRaids.forEach(pRaid => {
				let numberOfDiskSegments = pRaid.diskSegments.length;
				let segmentStatuses = new Array(numberOfDiskSegments).fill(diskSegmentsStatus);
				let pRaidReport = exports.buildPRaidReport(pRaid, segmentStatuses);

				let tomaLeader = pRaid.tomaLeader || pRaid.diskSegments[0].node_id;

				if (!tomaLeaderToPRaidReports[tomaLeader])
					tomaLeaderToPRaidReports[tomaLeader] = [];

				tomaLeaderToPRaidReports[tomaLeader].push(pRaidReport);
			});
		});
	});

	for (let [tomaLeader, pRaidReports] of Object.entries(tomaLeaderToPRaidReports)) {
		pRaidsReportsMessages.push(exports.generatePRaidsUpdateMessage(pRaidReports, tomaLeader));
	}

	return pRaidsReportsMessages;
};

exports.generateSinglePRaidUpdateMsg = function(volumePRaid, segmentStatus, tomaLeader) {
	let pRaidReport = exports.buildPRaidReport(volumePRaid, segmentStatus);
	let msg = exports.generatePRaidsUpdateMessage([pRaidReport], tomaLeader);
	return msg;
};

exports.reportAllSegmentsOnline = async function(dbVolume, leader) {
	let reports = [];
	dbVolume.chunks.forEach(chunk => {
		chunk.pRaids.forEach(pRaid => {
			let pRaidReport = PRaidReport.fromPRaid(pRaid);
			pRaidReport.setVersion(pRaid.version.major + 1, 0);
			pRaidReport.segments.forEach(segReport => {
				segReport.setStatus(consts.diskSegmentStatuses.NORMAL)
					.setVitality(consts.segmentVitality.UP);
			});

			reports.push(pRaidReport);
		});
	});

	return exports.sendPRaidUpdate(reports, leader);
};

exports.getAllVolumeSegments = function(dbVolume) {
	return dbVolume.chunks.flatMap(c => c.pRaids.flatMap(p => p.diskSegments));
};

exports.getSegmentsByStatus = function(segments, status) {
	return segments.filter(seg => seg.status === status);
};

exports.sendPRaidReportWithStatuses = function(dbVolume, statusMapper, target) {
	dbVolume.chunks.forEach(chunk => {
		chunk.pRaids.forEach(pRaid => {
			pRaid.diskSegments.forEach(seg => {
				seg.status = statusMapper(seg);
			});
		});
	});

	const msg = UpdatePRaidReportBuilder.fromVolume(dbVolume, target).build();
	return new Promise(resolve => volumeModule.handlePRaidStatusMessage(msg, resolve));
};

exports.sendDeprecationReport = function(dbVolume, segmentsToDeprecate, target) {
	const deprecateIds = new Set(segmentsToDeprecate.map(s => s._id));
	const builder = UpdatePRaidReportBuilder.fromTarget(target);

	dbVolume.chunks.forEach(chunk => {
		chunk.pRaids.forEach(pRaid => {
			const report = new PRaidReport(pRaid.uuid)
				.setVersion(pRaid.version.major, pRaid.version.minor)
				.setRaftTerm(pRaid.tomaLeaderRaftTerm);

			pRaid.diskSegments.forEach(seg => {
				const segReport = new SegmentReport(seg.uuid);

				if (deprecateIds.has(seg._id))
					segReport.setStatus(consts.diskSegmentStatuses.DEPRECATED);
				// TOMA reports conf_corrupted for segments on a non-existent drive UUID (e.g. reinstate fake UUID)
				else if (seg.status === consts.diskSegmentStatuses.MARKED_FOR_REBUILD_PENDING)
					segReport.setStatus('conf_corrupted').setVitality(consts.segmentVitality.DOWN);
				else
					segReport.setStatus(seg.status).setVitality(seg.vitality);

				report.addSegment(segReport);
			});

			builder.addPRaidReport(report);
		});
	});

	return new Promise(resolve => volumeModule.handlePRaidStatusMessage(builder.build(), resolve));
};

exports.assertVolumeStatusAndAction = function(dbVolume, expectedStatus, expectedAction) {
	assert.strictEqual(dbVolume.status, expectedStatus, `Expected volume status ${expectedStatus}, got ${dbVolume.status}`);
	assert.strictEqual(dbVolume.action, expectedAction, `Expected volume action ${expectedAction}, got ${dbVolume.action}`);
};

exports.assertSegmentCount = function(segments, status, expectedCount) {
	const actual = exports.getSegmentsByStatus(segments, status).length;
	assert.strictEqual(actual, expectedCount, `Expected ${expectedCount} segments with status ${status}, got ${actual}`);
};

exports.assertHasSegments = function(segments, status) {
	assert(exports.getSegmentsByStatus(segments, status).length, `Expected at least one segment with status ${status}`);
};

exports.assertFakeDriveSegmentsOnWire = function(tomaSegments, expectedCount) {
	const fakeDriveSegments = tomaSegments.filter(seg => seg.diskUUID === consts.REINSTATE_FAKE_DRIVE_UUID);
	assert.strictEqual(fakeDriveSegments.length, expectedCount,
		`Expected ${expectedCount} segments on fake drive UUID, got ${fakeDriveSegments.length}`);
	fakeDriveSegments.forEach(seg =>
		assert.strictEqual(seg.status, consts.diskSegmentStatuses.MARKED_FOR_REBUILD,
			`Fake-drive segment should be MARKED_FOR_REBUILD on the wire, got ${seg.status}`));
};


exports.assertUniqueSegmentUUIDsPerPRaid = function(payload, context = '') {
	payload.chunks.forEach(chunk => chunk.pRaids.forEach(pRaid => {
		const ids = pRaid.diskSegments.map(s => s.uuid);
		assert.strictEqual(new Set(ids).size, ids.length,
			`${context}TOMA must receive unique segmentIDs per pRaid; got duplicates: ${ids.join(', ')}`);
	}));
};

exports.startVolumeRebuildByIdsAndUUIDsAsync = function(volumeRef, user) {
	return new Promise((resolve, reject) => {
		startVolumeRebuildByIdsAndUUIDs([volumeRef], user, logs => {
			const response = logs[0].createApiResponse();
			if (!response.success)
				return reject(response);

			resolve(logs);
		});
	});
};

exports.reportReplacementNormalAndDeprecateOld = function(dbVolume, target) {
	return exports.sendPRaidReportWithStatuses(dbVolume, seg =>
		seg.status === consts.diskSegmentStatuses.MARKED_FOR_REBUILD_OLD
			? consts.diskSegmentStatuses.DEPRECATED
			: consts.diskSegmentStatuses.NORMAL,
	target);
};

exports.assertMarkedForRebuildAcceptsDirectNormalReport = async function(getVolume, target, { deprecationPath }) {
	let dbVolume = await getVolume();

	if (!deprecationPath) {
		const oldSegments = exports.getSegmentsByStatus(exports.getAllVolumeSegments(dbVolume), consts.diskSegmentStatuses.MARKED_FOR_REBUILD_OLD);
		await exports.sendDeprecationReport(dbVolume, oldSegments, target);
		dbVolume = await getVolume();
		exports.assertSegmentCount(exports.getAllVolumeSegments(dbVolume), consts.diskSegmentStatuses.MARKED_FOR_REBUILD_OLD, 0);
	}

	const replacementSeg = exports.getSegmentsByStatus(exports.getAllVolumeSegments(dbVolume), consts.diskSegmentStatuses.MARKED_FOR_REBUILD)[0];
	assert(replacementSeg, 'Expected a markedForRebuild replacement segment');

	if (deprecationPath)
		await exports.reportReplacementNormalAndDeprecateOld(dbVolume, target);
	else
		await exports.sendPRaidReportWithStatuses(dbVolume, () => consts.diskSegmentStatuses.NORMAL, target);

	dbVolume = await getVolume();
	const committed = exports.getAllVolumeSegments(dbVolume).find(s => s.uuid === replacementSeg.uuid);
	assert.strictEqual(committed.status, consts.diskSegmentStatuses.NORMAL, 'replacement must accept the direct normal report');
	exports.assertVolumeStatusAndAction(dbVolume, consts.volumeStatuses.ONLINE, consts.volumeActions.NONE);
	return dbVolume;
};

exports.completeReinstateFormatToMarkedForRebuild = async function({
	target, evictedDiskID, getVolume, deprecateOldSegments = true, assertFormatCommand = false
}) {
	let dbVolume = await getVolume();

	if (deprecateOldSegments) {
		const oldSegments = exports.getSegmentsByStatus(exports.getAllVolumeSegments(dbVolume), consts.diskSegmentStatuses.MARKED_FOR_REBUILD_OLD);
		await exports.sendDeprecationReport(dbVolume, oldSegments, target);
	}

	if (assertFormatCommand) {
		const formatMsg = await target.readMessageFromCommandsTopic();
		assert.strictEqual(formatMsg?.type, consts.kafkaMessageTypes.ManagementToTOMA.formatDrive, 'Format should auto-trigger after deprecation');
	}

	await syncTargetDiskFromDB(target, evictedDiskID, true);
	target.messageSequence += 1;
	await target.sendReport();

	await pollUntil(async() => {
		const vol = await getVolume();
		const segs = exports.getAllVolumeSegments(vol);
		return !segs.some(s => s.status === consts.diskSegmentStatuses.MARKED_FOR_REBUILD_PENDING)
			&& segs.some(s => s.status === consts.diskSegmentStatuses.MARKED_FOR_REBUILD);
	});

	dbVolume = await getVolume();
	exports.assertVolumeStatusAndAction(dbVolume, consts.volumeStatuses.DEGRADED, consts.volumeActions.MARKED_FOR_REBUILD);
	return dbVolume;
};

exports.bringRaid1ToMarkedForRebuild = async function({ volumeCollection, VolumeRAID1, volumeName, target }) {
	const volume = new VolumeRAID1(volumeName);
	const result = await volume.save();
	assert(result.success, 'Failed to create volume');

	let dbVolume = await volumeCollection.findOne({ _id: volume.name });
	volume.uuid = dbVolume.uuid;

	await exports.reportAllSegmentsOnline(dbVolume, target);

	dbVolume = await volumeCollection.findOne({ _id: volume.name });
	const seg = dbVolume.chunks[0].pRaids[0].diskSegments[0];
	await evictDisk({ diskID: seg.diskID, uuid: seg.diskUUID }, false, volume.createdBy);
	await exports.startVolumeRebuildByIdsAndUUIDsAsync({ _id: volume._id, uuid: volume.uuid }, volume.createdBy);

	dbVolume = await volumeCollection.findOne({ _id: volume.name });
	assert.strictEqual(dbVolume.action, consts.volumeActions.MARKED_FOR_REBUILD, 'Expected volume action markedForRebuild after rebuild start');
	assert(exports.getSegmentsByStatus(exports.getAllVolumeSegments(dbVolume), consts.diskSegmentStatuses.MARKED_FOR_REBUILD).length,
		'Expected a markedForRebuild replacement segment after rebuild start');
	return volume;
};

exports.sendPRaidUpdate = function(pRaidReports, leader) {
	let bulider = UpdatePRaidReportBuilder.fromTarget(leader);
	pRaidReports.forEach(p => bulider.addPRaidReport(p));
	let msg = bulider.build();

	return new Promise((resolve, reject) => {
		volumeModule.handlePRaidStatusMessage(msg, function(err) {
			if (err)
				return reject(err);

			resolve();
		});
	});
};

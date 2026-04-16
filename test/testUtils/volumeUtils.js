/*
 * SPDX-FileCopyrightText: Copyright (c) 2026 NVIDIA CORPORATION & AFFILIATES. All rights reserved.
 * SPDX-License-Identifier: Apache-2.0
 */


const consts = require('../../consts.js');
const assert = require('assert');
const { PRaidReport, SegmentReport, UpdatePRaidReportBuilder } = require('../kafkaMessages/fromTOMA/tomaMessageBuilders.js');
const volumeModule = require('../../modules/volume.js');
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

				if (deprecateIds.has(seg._id) && seg.status === consts.diskSegmentStatuses.MARKED_FOR_REBUILD_OLD)
					segReport.setStatus(consts.diskSegmentStatuses.DEPRECATED);
				// TOMA reports conf_corrupted for segments on a non-existent drive UUID (e.g. reinstate fake UUID)
				else if (seg.status === consts.diskSegmentStatuses.MARKED_FOR_REBUILD_PENDING)
					segReport.setStatus('conf_corrupted');
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

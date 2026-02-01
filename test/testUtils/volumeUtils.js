/*
 * SPDX-FileCopyrightText: Copyright (c) 2026 NVIDIA CORPORATION & AFFILIATES. All rights reserved.
 * SPDX-License-Identifier: Apache-2.0
 */


const consts = require('../../consts.js');
const assert = require('assert');
const { PRaidReport, UpdatePRaidReportBuilder } = require('../kafkaMessages/fromTOMA/tomaMessageBuilders.js');
const volumeModule = require('../../modules/volume.js');

exports.validateAllocatedBlocksAgainstCapacity = function(requestedCapacity, blocks) {
	// Actual allocated capacity could be smaller by up to BLOCK_SET_SIZE * BLOCK_SIZE difference
	let blockSetInBytes = consts.BLOCK_SIZE * consts.BLOCK_SET_SIZE;
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
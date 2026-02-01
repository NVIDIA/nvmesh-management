/*
 * SPDX-FileCopyrightText: Copyright (c) 2026 NVIDIA CORPORATION & AFFILIATES. All rights reserved.
 * SPDX-License-Identifier: Apache-2.0
 */

/* global app */

const async = require('async');
const assert = require('assert');

const { start, end } = require('../testUtils/timeUtils.js');

const { targetReport } = require('../../modules/target');
const { handlePRaidStatusMessage } = require('../../modules/volume.js');
const { generatePRaidReportMessagesByStatusFromVolumes } = require('../testUtils/volumeUtils.js');
const { RAIDLevel, diskSegmentStatuses, volumeStatuses } = require('../../consts');


exports.sendTargetReport = (target, callback) => {
	target.reportID += 1;
	target.messageSequence += 1;

	targetReport(target.node_id, target, (err) => {
		callback(err);
	});
};

function sendEntityReportFromAllEntities(entityName, sendEntityReportFunction, measurementName, testResultsReport, done) {
	app.get('db').collection(entityName).find().toArray()
		.then((entitiesBefore) => {
			let reportIDs = {};

			entitiesBefore.forEach(entity => reportIDs[entity._id] = entity.reportID + 1);

			start(measurementName, testResultsReport);

			async.each(entitiesBefore, sendEntityReportFunction, (err) => {
				if (err)
					done();

				else {
					end();

					app.get('db').collection(entityName).find().project({ _id: 1, reportID: 1 }).toArray()
						.then((entities) => {
							assert(entities.every(entity => entity.reportID === reportIDs[entity._id]));

							if (testResultsReport)
								testResultsReport.updateTestResults('moreInfo', `${entitiesBefore.length} ${entityName} reports`);

							done();
						})
						.catch(done);
				}
			});
		})
		.catch(done);
}

exports.sendTargetReportFromAllTargets = (measurementName, testResultsReport, done) => {
	sendEntityReportFromAllEntities('server', exports.sendTargetReport, measurementName, testResultsReport, done);
};

exports.sendClientReportFromAllClients = (measurementName, testResultsReport, done) => {
	sendEntityReportFromAllEntities('client', exports.sendClientReport, measurementName, testResultsReport, done);
};

exports.sendPRaidReport = (pRaidReport, callback) => {
	handlePRaidStatusMessage(pRaidReport, pRaidReport.registrant, (err) => {
		callback(err);
	});
};

exports.sendPRAIDReportFromAllTOMALeadersByStatus = (diskSegmentsStatus, measurementName, testResultsReport, done) => {
	let filterVolumesWithPRAIDs = { RAIDLevel: { $in: [RAIDLevel.MIRRORED_RAID_1,
		RAIDLevel.STRIPED_AND_MIRRORED_RAID_10, RAIDLevel.ERASURE_CODING, RAIDLevel.STRIPED_ERASURE_CODING] } };

	app.get('db').collection('volume').find(filterVolumesWithPRAIDs).project({ _id: 0, chunks: 1 }).toArray()
		.then((volumesBefore) => {
			let pRaidsReportsMessages = generatePRaidReportMessagesByStatusFromVolumes(volumesBefore, diskSegmentsStatus);

			start(measurementName, testResultsReport);

			async.each(pRaidsReportsMessages, exports.sendPRaidReport, (err) => {
				if (err)
					done();

				else {
					end();

					app.get('db').collection('volume').find(filterVolumesWithPRAIDs).project({ _id: 0, status: 1 }).toArray()
						.then((volumes) => {
							let expectedVolumeStatus;

							switch (diskSegmentsStatus) {
								case diskSegmentStatuses.NORMAL:
									expectedVolumeStatus = volumeStatuses.ONLINE;
									break;

								case diskSegmentStatuses.DEAD:
									expectedVolumeStatus = volumeStatuses.OFFLINE;
									break;

								case diskSegmentStatuses.DEPRECATED:
									expectedVolumeStatus = volumeStatuses.UNAVAILABLE;
									break;
							}
							assert(volumes.every(v => v.status === expectedVolumeStatus));

							if (testResultsReport)
								testResultsReport.updateTestResults('moreInfo',
									`${pRaidsReportsMessages.length} pRaid reports about ${volumesBefore.length} volumes`);

							done();
						})
						.catch(done);
				}
			});
		})
		.catch(done);
};

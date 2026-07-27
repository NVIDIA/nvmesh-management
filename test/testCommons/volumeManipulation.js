/* global app, it */

const async = require('async');
const assert = require('assert');

const { createVolumes } = require('../../utils');
const { markVolumesForDeletion } = require('../../modules/volume');
const { RAIDLevel, diskSegmentStatuses } = require('../../consts');

const { start, end } = require('../testUtils/timeUtils.js');
const { sendPRaidReport } = require('./reports');
const { generatePRaidReportMessagesByStatusFromVolumes } = require('../testUtils/volumeUtils');

const { TestResultsReport } = require('../testUtils/testReport');
const { VolumeConcatenated, VolumeRAID0, VolumeRAID1, VolumeRAID10, VolumeEC, VolumeStripedEC } = require('../models/volume');
const consts = require('../../consts');

const defaultUserEmail = consts.ADMIN_USER;
const user = { email: defaultUserEmail };


exports.getVolumeCreationTests = (dataSetName, numbersOfVolumes, raidLevels, singleMessage, multiMessage, testTimeOut) => {
	let startFrom = 1;
	let creationFunction = {
		single: exports.createVolumesByRaidLevelSingleMessages,
		multi: exports.createVolumesByRaidLevelMultiMessages
	};
	let payloadQuantities = [];

	if (singleMessage)
		payloadQuantities.push('single');

	if (multiMessage)
		payloadQuantities.push('multi');

	raidLevels.forEach(raidLevel => {
		numbersOfVolumes.forEach(numberOfVolumes => {
			let baseTitle = `Create ${numberOfVolumes} ${raidLevel} volumes`;

			payloadQuantities.forEach(qty => {
				let title = `${baseTitle} - ${qty} message`;
				let measurementName = `${dataSetName} - ${title}`;

				it(title, function(done) {
					this.test.testResultsReport = new TestResultsReport();
					creationFunction[qty](numberOfVolumes, raidLevel, startFrom, measurementName, this.test.testResultsReport, done);
					startFrom += numberOfVolumes;
				}).timeout(testTimeOut);
			});
		});
	});

};

function saveManyVolumes(volumes) {
	return new Promise(resolve => {
		createVolumes(volumes, user, results => {
			resolve(results);
		});
	});
}

function generateVolumesAndVolumeIDs(numOfVolumes, raidLevel, countStartFrom) {
	countStartFrom = parseInt(countStartFrom) || 0;

	let volumes = [];
	let volumeIDs = [];
	let instance, baseName;

	switch (raidLevel) {
		case (RAIDLevel.CONCATENATED): {
			instance = VolumeConcatenated;
			baseName = 'jbod';
			break;
		}
		case (RAIDLevel.STRIPED_RAID_0): {
			instance = VolumeRAID0;
			baseName = 'r0';
			break;
		}
		case (RAIDLevel.MIRRORED_RAID_1): {
			instance = VolumeRAID1;
			baseName = 'r1';
			break;
		}
		case (RAIDLevel.STRIPED_AND_MIRRORED_RAID_10): {
			instance = VolumeRAID10;
			baseName = 'r10';
			break;
		}
		case (RAIDLevel.ERASURE_CODING): {
			instance = VolumeEC;
			baseName = 'ec';
			break;
		}
		case (RAIDLevel.STRIPED_ERASURE_CODING): {
			instance = VolumeStripedEC;
			baseName = 'ec';
			break;
		}
	}

	for (let i = 0; i < numOfVolumes; i++) {
		let volumeID = `${baseName}-${countStartFrom + i}`;

		volumes.push(new instance(volumeID));
		volumeIDs.push(volumeID);
	}

	return { volumes, volumeIDs };
}

exports.createVolumesByRaidLevelMultiMessages = (numOfVolumes, raidLevel, countStartFrom, measurementName, testResultsReport, done) => {
	let { volumes, volumeIDs } = generateVolumesAndVolumeIDs(numOfVolumes, raidLevel, countStartFrom);

	start(measurementName, testResultsReport);

	Promise.all(volumes.map(volume => volume.save().then(result => assert(result.success))))
		.then(() => {
			end();

			app.get('db').collection('volume').count({ _id: { $in: volumeIDs } }).then(count => {
				assert.strictEqual(count, numOfVolumes);
				done();
			});
		})
		.catch(done);
};

exports.createVolumesByRaidLevelSingleMessages = (numOfVolumes, raidLevel, countStartFrom, measurementName, testResultsReport, done) => {
	let { volumes, volumeIDs } = generateVolumesAndVolumeIDs(numOfVolumes, raidLevel, countStartFrom);

	start(measurementName, testResultsReport);

	saveManyVolumes(volumes)
		.then(() => {
			end();

			app.get('db').collection('volume').count({ _id: { $in: volumeIDs } }).then(count => {
				assert.strictEqual(count, numOfVolumes);
				done();
			});
		})
		.catch(done);
};

exports.deleteAllVolumes = (measurementName, testResultsReport, done) => {
	app.get('db').collection('volume').find().project({ uuid: 1, chunks: 1 }).toArray()
		.then(volumes => {
			start(measurementName, testResultsReport);

			markVolumesForDeletion(volumes, () => {
				let pRaidsReportsMessages = generatePRaidReportMessagesByStatusFromVolumes(volumes, diskSegmentStatuses.DEPRECATED);

				async.each(pRaidsReportsMessages, sendPRaidReport, (err) => {
					if (err)
						done();

					else {
						end();

						app.get('db').collection('volume').count()
							.then((volumeNumber) => {
								assert(volumeNumber === 0);

								if (testResultsReport)
									testResultsReport.updateTestResults('moreInfo', `${volumes.length} volumes deleted`);

								done();
							})
							.catch(done);
					}
				});
			});
		})
		.catch(done);
};
/* global app */

const async = require('async');
const assert = require('assert');

const { reservationModes } = require('../../consts');
const { handleUpdateAttachment, getClientConfigurationByVolumes } = require('../../modules/client');

const { start, end } = require('../testUtils/timeUtils.js');

const { UpdateAttachmentMessage, BlockDevice } = require('../models/client.js');


function sendUpdateAttachmentMessage(report, callback) {
	handleUpdateAttachment(report.payload, (err) => {
		if (err)
			return callback(err);

		callback();
	});
}

exports.sendAttachmentMessageToAllVolumesFromAllClients = (measurementName, testResultsReport, done) => {
	let volNameToUUID = {};

	app.get('db').collection('volume').find().project({ _id: 0, name: 1, uuid: 1 }).toArray()
		.then(volumes => {
			volumes.forEach(vol => volNameToUUID[vol.name] = vol.uuid);

			app.get('db').collection('client').find().project({ _id: 0, reportID: 1, client_id: 1, clientToken: 1 }).toArray()
				.then(clients => {
					let reports = [];

					clients.forEach(client => {
						let clientToInstantiateFrom = {
							id: client.client_id,
							report: {
								block_devices: [],
								reportID: client.reportID + 1,
								clientToken: client.clientToken
							}
						};
						let sharedAttachment = new UpdateAttachmentMessage(clientToInstantiateFrom);

						volumes.forEach((vol) => {
							let attachment = new BlockDevice(vol.name).setReservationMode(reservationModes.SHARED_READ_WRITE).setUUID(vol.uuid);
							sharedAttachment.addAttachment(attachment);
						});

						reports.push(sharedAttachment);
					});

					start(measurementName, testResultsReport);

					async.each(reports, sendUpdateAttachmentMessage, (err) => {
						if (err)
							done();

						else {
							end();

							let pipeline = [
								{ $project: { attachmentsCount: { $size: '$block_devices' } } },
								{ $group: { _id: null, totalAttachmentsCount: { $sum: '$attachmentsCount' } } }
							];

							app.get('db').collection('client').aggregate(pipeline).toArray()
								.then(results => {
									assert(results[0].totalAttachmentsCount === (clients.length * volumes.length));

									if (testResultsReport)
										testResultsReport.updateTestResults('moreInfo', `${volumes.length}  volumes attached on ${clients.length} clients`);

									done();
								})
								.catch(done);
						}
					});
				})
				.catch(done);
		})
		.catch(done);
};

function getClientConfiguration(client, callback) {
	getClientConfigurationByVolumes(client.block_devices, (err, res) => {
		callback(err, res);
	});
}

exports.getAllClientsConfigurations = (measurementName, testResultsReport, done) => {
	let clientProject = { _id: 1, block_devices: 1, 'block_devices.name': 1, 'block_devices.uuid': 1 };

	app.get('db').collection('client').find().project(clientProject).toArray()
		.then(clients => {
			let results = [];

			function getClientConfigurationAndSaveResult(client, callback) {
				getClientConfiguration(client, (err, res) => {
					if (err)
						return callback(err);

					results.push(res);
					callback();
				});
			}

			start(measurementName, testResultsReport);

			async.each(clients, getClientConfigurationAndSaveResult, (err) => {
				if (err)
					done();

				else {
					end();

					assert(results.length === clients.length);

					if (testResultsReport)
						testResultsReport.updateTestResults('moreInfo', `${clients.length} clients`);

					done();
				}
			});
		})
		.catch(done);
};
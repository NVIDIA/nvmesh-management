/*
 * SPDX-FileCopyrightText: Copyright (c) 2026 NVIDIA CORPORATION & AFFILIATES. All rights reserved.
 * SPDX-License-Identifier: Apache-2.0
 */

/* global describe, before, it, after */

const consts = require('../consts.js');
const dbManager = require('./testUtils/dbManager.js');
const { setup } = require('./testUtils/setup.js');
const { TestResultsReport } = require('./testUtils/testReport.js');
const { diskSegmentStatuses } = require('../consts.js');
const { getAllTOMAsConfigurations } = require('./testCommons/target.js');
const { sendAttachmentMessageToAllVolumesFromAllClients, getAllClientsConfigurations } = require('./testCommons/client.js');
const { generateAndSaveTargetsPerZone, generateAndSaveClients, generateAndSaveVolumes } = require('./testUtils/entityGenerators.js');
const { deleteAllVolumes, getVolumeCreationTests } = require('./testCommons/volumeManipulation.js');
const { sendTargetReportFromAllTargets, sendClientReportFromAllClients, sendPRAIDReportFromAllTOMALeadersByStatus } = require('./testCommons/reports.js');

const UNIT_TEST_TIMEOUT = 300 * 1000; // 5 minutes
const SUITE_TIMEOUT = 300 * 1000; // 5 minutes

const allRaidLevels =
	[consts.RAIDLevel.CONCATENATED, consts.RAIDLevel.STRIPED_RAID_0, consts.RAIDLevel.MIRRORED_RAID_1, consts.RAIDLevel.STRIPED_AND_MIRRORED_RAID_10];

const DATA_SETS = {
	ONE: 'Data Set - 10 Targets, 3 Clients, 5 Volumes, 1 Zones',
	TWO: 'Data Set - 4800 Targets, 1000 Clients, 50 Volumes, 40 Zones',
};

const TESTS = {
	ATTACH_ALL_VOLUMES_TO_ALL_CLIENTS: 'Attach every volumes to every clients',
	GET_ALL_CLIENT_CONFIGURATION: 'Get client configuration for every clients',
	GET_ALL_TOMA_CONFIGURATION: 'Get TOMA configuration for every TOMA\'s',
	REPORT_FROM_ALL_TARGETS: 'Report from every targets',
	REPORT_FROM_ALL_CLIENTS: 'Report from every clients',
	REPORT_ALL_PRAIDS_NORMAL: 'Report every pRAID\'s with status \'normal\'',
	REPORT_ALL_PRAIDS_DEAD: 'Report every pRAID\'s with status \'dead\'',
	REPORT_ALL_PRAIDS_DEPRECATED: 'Report every pRAID\'s with status \'deprecated\'',
	DELETE_ALL_VOLUMES: 'Delete every volumes'
};

/* eslint-disable max-len */
function testDataSet(dataSetName) {
	getVolumeCreationTests(dataSetName, [1, 10], allRaidLevels, true, true, UNIT_TEST_TIMEOUT);

	it(TESTS.REPORT_FROM_ALL_CLIENTS, function(done) {
		this.test.testResultsReport = new TestResultsReport();
		sendClientReportFromAllClients(`${dataSetName} - ${TESTS.REPORT_FROM_ALL_CLIENTS}`, this.test.testResultsReport, done);
	}).timeout(UNIT_TEST_TIMEOUT);

	it(TESTS.ATTACH_ALL_VOLUMES_TO_ALL_CLIENTS, function(done) {
		this.test.testResultsReport = new TestResultsReport();
		sendAttachmentMessageToAllVolumesFromAllClients(`${dataSetName} - ${TESTS.ATTACH_ALL_VOLUMES_TO_ALL_CLIENTS}`, this.test.testResultsReport, done);
	}).timeout(UNIT_TEST_TIMEOUT);

	it(TESTS.GET_ALL_CLIENT_CONFIGURATION, function(done) {
		this.test.testResultsReport = new TestResultsReport();
		getAllClientsConfigurations(`${dataSetName} - ${TESTS.GET_ALL_CLIENT_CONFIGURATION}`, this.test.testResultsReport, done);
	}).timeout(UNIT_TEST_TIMEOUT);

	it(TESTS.GET_ALL_TOMA_CONFIGURATION, function(done) {
		this.test.testResultsReport = new TestResultsReport();
		getAllTOMAsConfigurations(`${dataSetName} - ${TESTS.GET_ALL_TOMA_CONFIGURATION}`, this.test.testResultsReport, done);
	}).timeout(UNIT_TEST_TIMEOUT);

	it(TESTS.REPORT_FROM_ALL_TARGETS, function(done) {
		this.test.testResultsReport = new TestResultsReport();
		sendTargetReportFromAllTargets(`${dataSetName} - ${TESTS.REPORT_FROM_ALL_TARGETS}`, this.test.testResultsReport, done);
	}).timeout(UNIT_TEST_TIMEOUT);

	it(TESTS.REPORT_ALL_PRAIDS_NORMAL, function(done) {
		this.test.testResultsReport = new TestResultsReport();
		sendPRAIDReportFromAllTOMALeadersByStatus(diskSegmentStatuses.NORMAL, `${dataSetName} - ${TESTS.REPORT_ALL_PRAIDS_NORMAL}`, this.test.testResultsReport, done);
	}).timeout(UNIT_TEST_TIMEOUT);

	it(TESTS.REPORT_ALL_PRAIDS_DEAD, function(done) {
		this.test.testResultsReport = new TestResultsReport();
		sendPRAIDReportFromAllTOMALeadersByStatus(diskSegmentStatuses.DEAD, `${dataSetName} - ${TESTS.REPORT_ALL_PRAIDS_DEAD}`, this.test.testResultsReport, done);
	}).timeout(UNIT_TEST_TIMEOUT);

	it(TESTS.REPORT_ALL_PRAIDS_DEPRECATED, function(done) {
		this.test.testResultsReport = new TestResultsReport();
		sendPRAIDReportFromAllTOMALeadersByStatus(diskSegmentStatuses.DEPRECATED, `${dataSetName} - ${TESTS.REPORT_ALL_PRAIDS_DEPRECATED}`, this.test.testResultsReport, done);
	}).timeout(UNIT_TEST_TIMEOUT);

	it(TESTS.DELETE_ALL_VOLUMES, function(done) {
		this.test.testResultsReport = new TestResultsReport();
		deleteAllVolumes(`${dataSetName} - ${TESTS.DELETE_ALL_VOLUMES}`, this.test.testResultsReport, done);
	}).timeout(UNIT_TEST_TIMEOUT);
}
/* eslint-enable max-len */

describe.skip('Scale Performance Testing', () => {

	before(function() {
		return dbManager.connect();
	});

	after(() => {
		return dbManager.closeConnection();
	});

	describe(DATA_SETS.ONE, function() {
		this.timeout(SUITE_TIMEOUT);

		before(function() {
			return setup.newSetup()
				.then(() => generateAndSaveTargetsPerZone(10, 1, 4, 2))
				.then(() => generateAndSaveClients(3))
				.then(() => generateAndSaveVolumes(1, 1, 1, 1, 1));
		});

		testDataSet(DATA_SETS.ONE);
	});

	describe(DATA_SETS.TWO, function() {
		this.timeout(SUITE_TIMEOUT);

		before(function() {
			return setup.newSetup()
				.then(() => generateAndSaveTargetsPerZone(120, 40, 1, 1))
				.then(() => generateAndSaveClients(1000))
				.then(() => generateAndSaveVolumes(10, 10, 10, 10, 10));
		});

		testDataSet(DATA_SETS.TWO);
	});
});

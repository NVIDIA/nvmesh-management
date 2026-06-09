/*
 * SPDX-FileCopyrightText: Copyright (c) 2026 NVIDIA CORPORATION & AFFILIATES. All rights reserved.
 * SPDX-License-Identifier: Apache-2.0
 */

/* global app,describe,before,beforeEach,it,after,afterEach */

const assert = require('assert');
const { promisify } = require('util');

const dbManager = require('./testUtils/dbManager.js');
const { setup, SetupOptions } = require('./testUtils/setup.js');
const entityGenerators = require('./testUtils/entityGenerators.js');
const upgradeModule = require('../modules/upgrade.js');
const releaseModule = require('../modules/release.js');
const utils = require('../utils.js');
const consts = require('../consts.js');
const systemMessages = require('../systemMessages.js');
const { SystemMessage } = require('../modules/error.js');

const ZONE = '1';
const HOSTNAME = 'host-1';
const PREV_HOSTNAME = 'host-0';
const UPGRADE_ID = 'test-upgrade-id';
const SOURCE_VERSION = '3.5.0-157';
// upgrade.destinationVersion holds a release name, not a target component version.
const DEST_RELEASE_NAME = '3.6';
// The actual target component version (baseVersion-revision) extracted from the release's target artifact.
const DEST_TARGET_VERSION = '3.6.0-203';

const verifyVolumeStateIsFreshAsync = promisify(upgradeModule.verifyVolumeStateIsFresh);
const executeStepsAsync = promisify(upgradeModule.executeSteps);
const loadExpectedTargetVersionsByZoneAsync = promisify(upgradeModule.loadExpectedTargetVersionsByZone);
const getDestinationTargetVersionAsync = promisify(upgradeModule.getDestinationTargetVersion);

let _nextStepIndex = 0;
function nextStepIndex() { return _nextStepIndex++; }
function resetStepIndex() { _nextStepIndex = 0; }

function generateUpgrade({ destinationVersion = DEST_RELEASE_NAME } = {}) {
	return entityGenerators.generateUpgrade({
		id: UPGRADE_ID,
		destinationVersion,
		hostname: HOSTNAME
	});
}

function generateStep(overrides = {}) {
	const stepIndex = overrides.stepIndex !== undefined ? overrides.stepIndex : nextStepIndex();
	return Object.assign(entityGenerators.generateUpgradeStep({
		id: `step-${stepIndex}`,
		upgradeID: UPGRADE_ID,
		hostname: HOSTNAME,
		stepIndex,
		isVolumeAffected: 1,
		status: consts.upgradeStepStatuses.PENDING,
		stepRetryCounter: 0
	}), overrides);
}

const origValidateFeatureCompatibility = utils.validateFeatureCompatibility;
function stubFeatureCompatibility(supported) {
	utils.validateFeatureCompatibility = (_req, cb) => cb(
		supported ? null : new SystemMessage(systemMessages.FEATURE_COMPATIBILITY_VERSION_NOT_MET));
}
function stubFeatureCompatibilityWithError(err) {
	utils.validateFeatureCompatibility = (_req, cb) => cb(err);
}
function restoreFeatureCompatibility() {
	utils.validateFeatureCompatibility = origValidateFeatureCompatibility;
}

const origGetDestinationTargetVersion = upgradeModule.getDestinationTargetVersion;
function stubDestinationTargetVersion(version = DEST_TARGET_VERSION) {
	upgradeModule.getDestinationTargetVersion = (_destinationVersion, cb) => cb(null, version);
}
function restoreDestinationTargetVersion() {
	upgradeModule.getDestinationTargetVersion = origGetDestinationTargetVersion;
}

function expectMessage(messageId) {
	return (err) => err.additionalInfo.id === messageId;
}

async function clearFreshnessCollections() {
	const db = app.get('db');
	await Promise.all([
		db.collection('server').deleteMany({}),
		db.collection('configurationVersion').deleteMany({}),
		db.collection('volume').deleteMany({}),
		db.collection('upgradeStep').deleteMany({})
	]);
}

async function seedTargetInZone(nodeID = HOSTNAME, version = SOURCE_VERSION, zone = ZONE) {
	await app.get('db').collection('server').insertOne({
		_id: nodeID,
		node_id: nodeID,
		zone,
		version
	});
}

async function seedLeader({ updatePRaidToken, raftMembers, isReconciled, zone = ZONE } = {}) {
	const doc = { _id: zone };
	if (updatePRaidToken !== undefined) doc.updatePRaidToken = updatePRaidToken;
	if (raftMembers !== undefined) doc.raftMembers = raftMembers;
	if (isReconciled !== undefined) doc.isReconciled = isReconciled;
	await app.get('db').collection('configurationVersion').insertOne(doc);
}

async function seedPRaidsForHost(host, updatePRaidToken, zone = ZONE) {
	const pRaid = entityGenerators.generatePRaid({ zone, host, updatePRaidToken });
	await app.get('db').collection('volume').insertOne(
		{ chunks: [{ pRaids: [pRaid] }] });
}

async function seedReservedPRaidsForHost(host, updatePRaidToken, zone = ZONE) {
	const pRaid = entityGenerators.generatePRaid({ zone, host, updatePRaidToken });
	await app.get('db').collection('volume').insertOne(
		{ isReserved: true, chunks: [{ pRaids: [pRaid] }] });
}

async function seedCompletedPrevStep({ hostname = PREV_HOSTNAME, finishedAt } = {}) {
	const stepIndex = nextStepIndex();
	await app.get('db').collection('upgradeStep').insertOne(
		entityGenerators.generateUpgradeStep({
			id: `step-${hostname}-${stepIndex}`,
			upgradeID: UPGRADE_ID,
			hostname,
			stepIndex,
			name: consts.upgradeStepNames.START_TARGET,
			status: consts.upgradeStepStatuses.COMPLETED,
			isVolumeAffected: 1,
			finishedAt
		}));
}

describe('Upgrade', function() {

	before(async() => {
		await dbManager.connect();
	});

	after(async() => {
		await dbManager.closeConnection();
	});

	describe('#verifyVolumeStateIsFresh - feature-compat dispatcher', function() {

		before(async() => {
			await setup.newSetup(new SetupOptions().setEnableZones(true));
		});

		beforeEach(async() => {
			resetStepIndex();
			await clearFreshnessCollections();
		});

		afterEach(() => {
			restoreFeatureCompatibility();
		});

		it('falls back to the elapsed-time path when the FCV check rejects with FEATURE_COMPATIBILITY_VERSION_NOT_MET', async() => {
			stubFeatureCompatibility(false);
			await seedCompletedPrevStep({ finishedAt: new Date(Date.now() - consts.MIN_FRESHNESS_WAIT_MS + 1000) });

			await assert.rejects(
				verifyVolumeStateIsFreshAsync(generateUpgrade(), generateStep()),
				expectMessage(systemMessages.UPGRADE_STEP_CANNOT_BE_EXECUTED_VOLUME_STATE.id));
		});

		it('bubbles up non-FCV errors from validateFeatureCompatibility instead of falling back to the elapsed-time path', async() => {
			const fcvErr = new Error('mongo blew up while checking FCV');
			stubFeatureCompatibilityWithError(fcvErr);

			await assert.rejects(
				verifyVolumeStateIsFreshAsync(generateUpgrade(), generateStep()),
				err => err === fcvErr);
		});

		it('bubbles up a non-FCV SystemMessage from validateFeatureCompatibility (additionalInfo.id mismatch)', async() => {
			const otherSysErr = new SystemMessage(systemMessages.UPGRADE_STEP_CANNOT_BE_EXECUTED_VOLUME_STATE);
			stubFeatureCompatibilityWithError(otherSysErr);

			await assert.rejects(
				verifyVolumeStateIsFreshAsync(generateUpgrade(), generateStep()),
				err => err === otherSysErr);
		});
	});

	describe('#verifyVolumeStateIsFresh - feature-compat supported path', function() {

		before(async() => {
			await setup.newSetup(new SetupOptions().setEnableZones(true));
		});

		beforeEach(async() => {
			resetStepIndex();
			stubFeatureCompatibility(true);
			stubDestinationTargetVersion();
			await clearFreshnessCollections();
			await seedTargetInZone(HOSTNAME);
			await seedTargetInZone(PREV_HOSTNAME);
		});

		afterEach(() => {
			restoreFeatureCompatibility();
			restoreDestinationTargetVersion();
		});

		it('rejects with LEADER_NOT_RECONCILED when the leader keepalive carries no updatePRaidToken yet', async() => {
			await seedLeader({ raftMembers: [], isReconciled: true });

			await assert.rejects(
				verifyVolumeStateIsFreshAsync(generateUpgrade(), generateStep()),
				expectMessage(systemMessages.UPGRADE_STEP_CANNOT_BE_EXECUTED_LEADER_NOT_RECONCILED.id));
		});

		it('rejects with LEADER_NOT_RECONCILED when isReconciled is false (no upgradeStep / volume queries should run)', async() => {
			// state that would otherwise raise a different error must be ignored here
			await seedLeader({ updatePRaidToken: 7, raftMembers: [], isReconciled: false });
			await seedPRaidsForHost(HOSTNAME, 1);
			await seedCompletedPrevStep();

			await assert.rejects(
				verifyVolumeStateIsFreshAsync(generateUpgrade(), generateStep()),
				expectMessage(systemMessages.UPGRADE_STEP_CANNOT_BE_EXECUTED_LEADER_NOT_RECONCILED.id));
		});

		it('passes when there are no zone leaders at all (configurationVersion has no per-zone docs)', async() => {
			// Even with state that would otherwise trip the supported-path checks, a cluster with no zone
			// leaders has nothing to validate against and must not block the step.
			await seedPRaidsForHost(HOSTNAME, 1);
			await seedCompletedPrevStep();

			await verifyVolumeStateIsFreshAsync(generateUpgrade(), generateStep());
		});

		it('rejects with LEADER_HAS_NOT_OBSERVED_PREV_TARGET when an expected target is missing from raftMembers', async() => {
			await seedLeader({
				updatePRaidToken: 7,
				raftMembers: [{ memberID: HOSTNAME, version: SOURCE_VERSION }],
				isReconciled: true
			});
			await seedPRaidsForHost(HOSTNAME, 7);

			await assert.rejects(
				verifyVolumeStateIsFreshAsync(generateUpgrade(), generateStep()),
				expectMessage(systemMessages.UPGRADE_STEP_CANNOT_BE_EXECUTED_LEADER_HAS_NOT_OBSERVED_PREV_TARGET.id));
		});

		it('rejects with LEADER_NOT_RECONCILED when any other zone\'s leader is unreconciled (even if step.hostname\'s zone is fine)',
			async() => {
				const OTHER_ZONE = '2';

				await seedLeader({
					updatePRaidToken: 7,
					raftMembers: [
						{ memberID: HOSTNAME, version: SOURCE_VERSION },
						{ memberID: PREV_HOSTNAME, version: SOURCE_VERSION }
					],
					isReconciled: true
				});
				await seedPRaidsForHost(HOSTNAME, 7);
				await seedLeader({ zone: OTHER_ZONE, updatePRaidToken: 12, raftMembers: [], isReconciled: false });

				await assert.rejects(
					verifyVolumeStateIsFreshAsync(generateUpgrade(), generateStep()),
					expectMessage(systemMessages.UPGRADE_STEP_CANNOT_BE_EXECUTED_LEADER_NOT_RECONCILED.id));
			});

		it('rejects with LEADER_HAS_NOT_OBSERVED_PREV_TARGET when another zone\'s leader has not observed its expected target versions',
			async() => {
				const OTHER_ZONE = '2';
				const OTHER_HOSTNAME = 'host-in-other-zone';

				// step.hostname's zone is fully consistent
				await seedLeader({
					updatePRaidToken: 7,
					raftMembers: [
						{ memberID: HOSTNAME, version: SOURCE_VERSION },
						{ memberID: PREV_HOSTNAME, version: SOURCE_VERSION }
					],
					isReconciled: true
				});
				await seedPRaidsForHost(HOSTNAME, 7);

				// another zone has a target whose version is NOT in the other-zone leader's raftMembers
				await seedTargetInZone(OTHER_HOSTNAME, SOURCE_VERSION, OTHER_ZONE);
				await seedLeader({ zone: OTHER_ZONE, updatePRaidToken: 7, raftMembers: [], isReconciled: true });

				await assert.rejects(
					verifyVolumeStateIsFreshAsync(generateUpgrade(), generateStep()),
					expectMessage(systemMessages.UPGRADE_STEP_CANNOT_BE_EXECUTED_LEADER_HAS_NOT_OBSERVED_PREV_TARGET.id));
			});

		it('rejects with LEADER_HAS_NOT_OBSERVED_PREV_TARGET when a target with a COMPLETED startTarget is still on the source version in raftMembers',
			async() => {
				await seedLeader({
					updatePRaidToken: 7,
					raftMembers: [
						{ memberID: HOSTNAME, version: SOURCE_VERSION },
						{ memberID: PREV_HOSTNAME, version: SOURCE_VERSION }
					],
					isReconciled: true
				});
				await seedPRaidsForHost(HOSTNAME, 7);
				await seedCompletedPrevStep();

				await assert.rejects(
					verifyVolumeStateIsFreshAsync(generateUpgrade(), generateStep()),
					expectMessage(systemMessages.UPGRADE_STEP_CANNOT_BE_EXECUTED_LEADER_HAS_NOT_OBSERVED_PREV_TARGET.id));
			});

		it('runs the prev-target check before the pRaid check (a stale pRaid does not mask LEADER_HAS_NOT_OBSERVED_PREV_TARGET)', async() => {
			await seedLeader({
				updatePRaidToken: 7,
				raftMembers: [{ memberID: HOSTNAME, version: SOURCE_VERSION }],
				isReconciled: true
			});
			await seedPRaidsForHost(HOSTNAME, 1);
			await seedCompletedPrevStep();

			await assert.rejects(
				verifyVolumeStateIsFreshAsync(generateUpgrade(), generateStep()),
				expectMessage(systemMessages.UPGRADE_STEP_CANNOT_BE_EXECUTED_LEADER_HAS_NOT_OBSERVED_PREV_TARGET.id));
		});

		it('rejects with VOLUME_STATE when a pRaid in some zone has an updatePRaidToken older than that zone\'s leader', async() => {
			await seedLeader({
				updatePRaidToken: 7,
				raftMembers: [
					{ memberID: HOSTNAME, version: SOURCE_VERSION },
					{ memberID: PREV_HOSTNAME, version: DEST_TARGET_VERSION }
				],
				isReconciled: true
			});
			await seedPRaidsForHost(HOSTNAME, 3);
			await seedCompletedPrevStep();

			await assert.rejects(
				verifyVolumeStateIsFreshAsync(generateUpgrade(), generateStep()),
				expectMessage(systemMessages.UPGRADE_STEP_CANNOT_BE_EXECUTED_VOLUME_STATE.id));
		});

		it('rejects with VOLUME_STATE when a pRaid in some zone has no updatePRaidToken at all', async() => {
			await seedLeader({
				updatePRaidToken: 7,
				raftMembers: [
					{ memberID: HOSTNAME, version: SOURCE_VERSION },
					{ memberID: PREV_HOSTNAME, version: DEST_TARGET_VERSION }
				],
				isReconciled: true
			});
			await seedPRaidsForHost(HOSTNAME);
			await seedCompletedPrevStep();

			await assert.rejects(
				verifyVolumeStateIsFreshAsync(generateUpgrade(), generateStep()),
				expectMessage(systemMessages.UPGRADE_STEP_CANNOT_BE_EXECUTED_VOLUME_STATE.id));
		});

		it('ignores reserved volumes (never reported by TOMA, so their pRaids never carry a token)', async() => {
			await seedLeader({
				updatePRaidToken: 7,
				raftMembers: [
					{ memberID: HOSTNAME, version: SOURCE_VERSION },
					{ memberID: PREV_HOSTNAME, version: SOURCE_VERSION }
				],
				isReconciled: true
			});
			// A real, TOMA-managed volume that is fresh...
			await seedPRaidsForHost(HOSTNAME, 7);
			// ...alongside a reserved volume whose pRaid has no token must not block the step.
			await seedReservedPRaidsForHost(HOSTNAME);

			await verifyVolumeStateIsFreshAsync(generateUpgrade(), generateStep());
		});

		it('still rejects with VOLUME_STATE for a stale non-reserved volume even when a reserved volume is present', async() => {
			await seedLeader({
				updatePRaidToken: 7,
				raftMembers: [
					{ memberID: HOSTNAME, version: SOURCE_VERSION },
					{ memberID: PREV_HOSTNAME, version: SOURCE_VERSION }
				],
				isReconciled: true
			});
			await seedReservedPRaidsForHost(HOSTNAME);
			await seedPRaidsForHost(HOSTNAME, 3);

			await assert.rejects(
				verifyVolumeStateIsFreshAsync(generateUpgrade(), generateStep()),
				expectMessage(systemMessages.UPGRADE_STEP_CANNOT_BE_EXECUTED_VOLUME_STATE.id));
		});

		it('rejects with VOLUME_STATE when a pRaid in another zone is stale relative to that zone\'s leader (cross-zone freshness)', async() => {
			const OTHER_ZONE = '2';

			// step.hostname's zone is fully fresh
			await seedLeader({
				updatePRaidToken: 7,
				raftMembers: [
					{ memberID: HOSTNAME, version: SOURCE_VERSION },
					{ memberID: PREV_HOSTNAME, version: SOURCE_VERSION }
				],
				isReconciled: true
			});
			await seedPRaidsForHost(HOSTNAME, 7);

			// another zone has a leader that has advanced past its pRaids
			await seedLeader({ zone: OTHER_ZONE, updatePRaidToken: 12, raftMembers: [], isReconciled: true });
			await seedPRaidsForHost('host-in-other-zone', 5, OTHER_ZONE);

			await assert.rejects(
				verifyVolumeStateIsFreshAsync(generateUpgrade(), generateStep()),
				expectMessage(systemMessages.UPGRADE_STEP_CANNOT_BE_EXECUTED_VOLUME_STATE.id));
		});

		it('passes when each zone\'s pRaids are fresh according to that zone\'s own leader (different zones can hold different tokens)', async() => {
			const OTHER_ZONE = '2';

			await seedLeader({
				updatePRaidToken: 7,
				raftMembers: [
					{ memberID: HOSTNAME, version: SOURCE_VERSION },
					{ memberID: PREV_HOSTNAME, version: SOURCE_VERSION }
				],
				isReconciled: true
			});
			await seedPRaidsForHost(HOSTNAME, 7);

			// another zone with a much higher token; its own pRaid is fresh against its own leader
			await seedLeader({ zone: OTHER_ZONE, updatePRaidToken: 99, raftMembers: [], isReconciled: true });
			await seedPRaidsForHost('host-in-other-zone', 99, OTHER_ZONE);

			await verifyVolumeStateIsFreshAsync(generateUpgrade(), generateStep());
		});

		it('passes when expected versions match raftMembers exactly (with destination target version override applied) and pRaids are fresh', async() => {
			await seedLeader({
				updatePRaidToken: 7,
				raftMembers: [
					{ memberID: HOSTNAME, version: SOURCE_VERSION },
					{ memberID: PREV_HOSTNAME, version: DEST_TARGET_VERSION }
				],
				isReconciled: true
			});
			await seedPRaidsForHost(HOSTNAME, 7);
			await seedCompletedPrevStep();

			await verifyVolumeStateIsFreshAsync(generateUpgrade(), generateStep());
		});

		it('passes when raftMembers contains extra members not in the target collection', async() => {
			await seedLeader({
				updatePRaidToken: 7,
				raftMembers: [
					{ memberID: HOSTNAME, version: SOURCE_VERSION },
					{ memberID: PREV_HOSTNAME, version: SOURCE_VERSION },
					{ memberID: 'orphan-host', version: '4.0.0-1' }
				],
				isReconciled: true
			});
			await seedPRaidsForHost(HOSTNAME, 7);

			await verifyVolumeStateIsFreshAsync(generateUpgrade(), generateStep());
		});

		it('does not apply the destination target version override for startTarget steps from other upgrades or steps that are not yet completed', async() => {
			await seedLeader({
				updatePRaidToken: 7,
				raftMembers: [
					{ memberID: HOSTNAME, version: SOURCE_VERSION },
					{ memberID: PREV_HOSTNAME, version: SOURCE_VERSION }
				],
				isReconciled: true
			});
			await seedPRaidsForHost(HOSTNAME, 7);

			await app.get('db').collection('upgradeStep').insertMany([
				entityGenerators.generateUpgradeStep({
					id: 'step-startTarget-other-upgrade',
					upgradeID: 'some-other-upgrade',
					hostname: PREV_HOSTNAME,
					stepIndex: nextStepIndex(),
					name: consts.upgradeStepNames.START_TARGET,
					status: consts.upgradeStepStatuses.COMPLETED
				}),
				entityGenerators.generateUpgradeStep({
					id: 'step-startTarget-still-pending',
					upgradeID: UPGRADE_ID,
					hostname: PREV_HOSTNAME,
					stepIndex: nextStepIndex(),
					name: consts.upgradeStepNames.START_TARGET,
					status: consts.upgradeStepStatuses.PENDING
				})
			]);

			await verifyVolumeStateIsFreshAsync(generateUpgrade(), generateStep());
		});
	});

	describe('#verifyVolumeStateIsFresh - feature-compat unsupported (legacy) path', function() {

		before(async() => {
			await setup.newSetup(new SetupOptions().setEnableZones(true));
		});

		beforeEach(async() => {
			resetStepIndex();
			stubFeatureCompatibility(false);
			await clearFreshnessCollections();
		});

		afterEach(() => {
			restoreFeatureCompatibility();
		});

		it('passes when there is no previous completed startTarget step in this upgrade', async() => {
			await verifyVolumeStateIsFreshAsync(generateUpgrade(), generateStep());
		});

		it('rejects with VOLUME_STATE when not enough time has elapsed since the last startTarget', async() => {
			await seedCompletedPrevStep({ finishedAt: new Date(Date.now() - consts.MIN_FRESHNESS_WAIT_MS + 1000) });

			await assert.rejects(
				verifyVolumeStateIsFreshAsync(generateUpgrade(), generateStep()),
				expectMessage(systemMessages.UPGRADE_STEP_CANNOT_BE_EXECUTED_VOLUME_STATE.id));
		});

		it('passes when MIN_FRESHNESS_WAIT_MS has elapsed since the last startTarget', async() => {
			await seedCompletedPrevStep({ finishedAt: new Date(Date.now() - consts.MIN_FRESHNESS_WAIT_MS - 1000) });

			await verifyVolumeStateIsFreshAsync(generateUpgrade(), generateStep());
		});

		it('ignores prev completed steps that are not startTarget', async() => {
			const stepIndex = nextStepIndex();
			await app.get('db').collection('upgradeStep').insertOne(
				entityGenerators.generateUpgradeStep({
					id: `step-stop-${stepIndex}`,
					upgradeID: UPGRADE_ID,
					hostname: PREV_HOSTNAME,
					stepIndex,
					name: 'stopTarget',
					status: consts.upgradeStepStatuses.COMPLETED,
					isVolumeAffected: 1,
					finishedAt: new Date(Date.now() - consts.MIN_FRESHNESS_WAIT_MS + 1000)
				}));

			await verifyVolumeStateIsFreshAsync(generateUpgrade(), generateStep());
		});

		it('does not query the leader / volumes / target collections in the legacy path', async() => {
			// state that would fail the supported path must be ignored here
			await seedTargetInZone();
			await seedLeader({ updatePRaidToken: 99, raftMembers: [], isReconciled: false });
			await seedPRaidsForHost(HOSTNAME, 1);

			await verifyVolumeStateIsFreshAsync(generateUpgrade(), generateStep());
		});
	});

	describe('#areExpectedTargetsObservedByLeader', function() {
		const subject = upgradeModule.areExpectedTargetsObservedByLeader;

		it('returns true when the expected versions object is empty', async() => {
			assert.strictEqual(subject({}, []), true);
			assert.strictEqual(subject({}, [{ memberID: 'h1', version: '3.5.0-157' }]), true);
		});

		it('returns true when raftMembers is null/undefined and the expected versions object is empty', async() => {
			assert.strictEqual(subject({}, null), true);
			assert.strictEqual(subject({}, undefined), true);
		});

		it('returns false when raftMembers is null/undefined and the expected versions object has any entry', async() => {
			assert.strictEqual(subject({ h1: '3.5.0-157' }, null), false);
			assert.strictEqual(subject({ h1: '3.5.0-157' }, undefined), false);
		});

		it('returns true when every expected entry has an exact-version match in raftMembers', async() => {
			const expected = { h1: '3.5.0-157', h2: '3.6.0-203' };
			const actual = [
				{ memberID: 'h1', version: '3.5.0-157' },
				{ memberID: 'h2', version: '3.6.0-203' }
			];
			assert.strictEqual(subject(expected, actual), true);
		});

		it('returns false when an expected memberID is missing from raftMembers', async() => {
			const expected = { h1: '3.5.0-157', h2: '3.6.0-203' };
			const actual = [{ memberID: 'h1', version: '3.5.0-157' }];
			assert.strictEqual(subject(expected, actual), false);
		});

		it('returns false when an expected memberID has a different version in raftMembers', async() => {
			assert.strictEqual(
				subject({ h1: '3.6.0-203' }, [{ memberID: 'h1', version: '3.5.0-157' }]),
				false);
		});

		it('returns false when only the revision suffix differs (no fuzzy matching on version-revision)', async() => {
			assert.strictEqual(
				subject({ h1: '3.5.0-157' }, [{ memberID: 'h1', version: '3.5.0-156' }]),
				false);
			assert.strictEqual(
				subject({ h1: '3.5.0-157' }, [{ memberID: 'h1', version: '3.5.0' }]),
				false);
		});

		it('ignores raftMembers that are not in the expected versions object (extras are allowed)', async() => {
			const expected = { h1: '3.5.0-157' };
			const actual = [
				{ memberID: 'h1', version: '3.5.0-157' },
				{ memberID: 'orphan', version: '4.0.0-1' },
				{ memberID: 'another-orphan', version: '2.0.0-99' }
			];
			assert.strictEqual(subject(expected, actual), true);
		});

		it('returns false when an expected memberID exists in raftMembers without a version', async() => {
			assert.strictEqual(subject({ h1: '3.5.0-157' }, [{ memberID: 'h1' }]), false);
		});

		it('handles a single mismatch in a multi-entry expected versions object', async() => {
			const expected = { h1: '3.5.0-157', h2: '3.6.0-203', h3: '3.6.0-203' };
			const actual = [
				{ memberID: 'h1', version: '3.5.0-157' },
				{ memberID: 'h2', version: '3.5.0-157' },
				{ memberID: 'h3', version: '3.6.0-203' }
			];
			assert.strictEqual(subject(expected, actual), false);
		});
	});

	describe('#loadExpectedTargetVersionsByZone', function() {

		before(async() => {
			await setup.newSetup(new SetupOptions().setEnableZones(true));
		});

		beforeEach(async() => {
			resetStepIndex();
			stubDestinationTargetVersion();
			await clearFreshnessCollections();
		});

		afterEach(() => {
			restoreDestinationTargetVersion();
		});

		it('returns an empty object when no zones are requested', async() => {
			await seedTargetInZone(HOSTNAME, SOURCE_VERSION);

			const result = await loadExpectedTargetVersionsByZoneAsync(generateUpgrade(), []);

			assert.deepStrictEqual(result, {});
		});

		it('returns each requested zone keyed even when it has no targets', async() => {
			const result = await loadExpectedTargetVersionsByZoneAsync(generateUpgrade(), [ZONE, 'other-zone']);

			assert.deepStrictEqual(result, { [ZONE]: {}, 'other-zone': {} });
		});

		it('groups every non-DELETING target by zone at its current version', async() => {
			await seedTargetInZone(HOSTNAME, SOURCE_VERSION, ZONE);
			await seedTargetInZone(PREV_HOSTNAME, SOURCE_VERSION, ZONE);
			await seedTargetInZone('host-2', SOURCE_VERSION, 'other-zone');

			const result = await loadExpectedTargetVersionsByZoneAsync(generateUpgrade(), [ZONE, 'other-zone']);

			assert.deepStrictEqual(result, {
				[ZONE]: { [HOSTNAME]: SOURCE_VERSION, [PREV_HOSTNAME]: SOURCE_VERSION },
				'other-zone': { 'host-2': SOURCE_VERSION }
			});
		});

		it('does not include targets from zones outside the requested set', async() => {
			await seedTargetInZone(HOSTNAME, SOURCE_VERSION, ZONE);
			await seedTargetInZone(PREV_HOSTNAME, SOURCE_VERSION, 'other-zone');

			const result = await loadExpectedTargetVersionsByZoneAsync(generateUpgrade(), [ZONE]);

			assert.deepStrictEqual(result, { [ZONE]: { [HOSTNAME]: SOURCE_VERSION } });
		});

		it('skips targets that are in DELETING status', async() => {
			await seedTargetInZone(HOSTNAME, SOURCE_VERSION);
			await app.get('db').collection('server').insertOne({
				_id: 'deleting-host',
				node_id: 'deleting-host',
				zone: ZONE,
				version: SOURCE_VERSION,
				node_status: consts.nodeStatus.DELETING
			});

			const result = await loadExpectedTargetVersionsByZoneAsync(generateUpgrade(), [ZONE]);

			assert.deepStrictEqual(result, { [ZONE]: { [HOSTNAME]: SOURCE_VERSION } });
		});

		it('overrides the version to the destination target version for targets with a COMPLETED startTarget step in this upgrade', async() => {
			await seedTargetInZone(HOSTNAME, SOURCE_VERSION);
			await seedTargetInZone(PREV_HOSTNAME, SOURCE_VERSION);
			await seedCompletedPrevStep();

			const result = await loadExpectedTargetVersionsByZoneAsync(generateUpgrade(), [ZONE]);

			assert.deepStrictEqual(result, {
				[ZONE]: { [HOSTNAME]: SOURCE_VERSION, [PREV_HOSTNAME]: DEST_TARGET_VERSION }
			});
		});

		it('applies the destination override only inside the host\'s actual zone', async() => {
			await seedTargetInZone(HOSTNAME, SOURCE_VERSION, ZONE);
			await seedTargetInZone(PREV_HOSTNAME, SOURCE_VERSION, 'other-zone');
			await seedCompletedPrevStep(); // hostname=PREV_HOSTNAME, in other-zone

			const result = await loadExpectedTargetVersionsByZoneAsync(generateUpgrade(), [ZONE, 'other-zone']);

			assert.deepStrictEqual(result, {
				[ZONE]: { [HOSTNAME]: SOURCE_VERSION },
				'other-zone': { [PREV_HOSTNAME]: DEST_TARGET_VERSION }
			});
		});

		it('does not apply the override for a COMPLETED startTarget whose host is not in any requested zone', async() => {
			await seedTargetInZone(HOSTNAME, SOURCE_VERSION, ZONE);
			await seedTargetInZone(PREV_HOSTNAME, SOURCE_VERSION, 'other-zone');
			await seedCompletedPrevStep(); // hostname=PREV_HOSTNAME, in other-zone

			const result = await loadExpectedTargetVersionsByZoneAsync(generateUpgrade(), [ZONE]);

			assert.deepStrictEqual(result, { [ZONE]: { [HOSTNAME]: SOURCE_VERSION } });
		});

		it('does not apply the override for startTarget steps from other upgrades or for non-COMPLETED steps', async() => {
			await seedTargetInZone(HOSTNAME, SOURCE_VERSION);
			await seedTargetInZone(PREV_HOSTNAME, SOURCE_VERSION);

			await app.get('db').collection('upgradeStep').insertMany([
				entityGenerators.generateUpgradeStep({
					id: 'startTarget-other-upgrade',
					upgradeID: 'some-other-upgrade',
					hostname: PREV_HOSTNAME,
					stepIndex: nextStepIndex(),
					name: consts.upgradeStepNames.START_TARGET,
					status: consts.upgradeStepStatuses.COMPLETED
				}),
				entityGenerators.generateUpgradeStep({
					id: 'startTarget-still-pending',
					upgradeID: UPGRADE_ID,
					hostname: PREV_HOSTNAME,
					stepIndex: nextStepIndex(),
					name: consts.upgradeStepNames.START_TARGET,
					status: consts.upgradeStepStatuses.PENDING
				}),
				entityGenerators.generateUpgradeStep({
					id: 'stopTarget-completed',
					upgradeID: UPGRADE_ID,
					hostname: PREV_HOSTNAME,
					stepIndex: nextStepIndex(),
					name: 'stopTarget',
					status: consts.upgradeStepStatuses.COMPLETED
				})
			]);

			const result = await loadExpectedTargetVersionsByZoneAsync(generateUpgrade(), [ZONE]);

			assert.deepStrictEqual(result, {
				[ZONE]: { [HOSTNAME]: SOURCE_VERSION, [PREV_HOSTNAME]: SOURCE_VERSION }
			});
		});
	});

	describe('#getDestinationTargetVersion', function() {
		const origGetAllReleases = releaseModule.getAllReleases;

		function stubReleaseWithArtifacts(artifactNames) {
			releaseModule.getAllReleases = (_query, cb) => cb(null, [{
				version: DEST_RELEASE_NAME,
				artifacts: artifactNames.map(name => ({ name }))
			}]);
		}

		afterEach(() => {
			releaseModule.getAllReleases = origGetAllReleases;
		});

		it('returns the only target version when the release has a single target artifact', async() => {
			stubReleaseWithArtifacts(['nvmesh-target-3.6.0-203.el8.x86_64.rpm']);

			const result = await getDestinationTargetVersionAsync(DEST_RELEASE_NAME);

			assert.strictEqual(result, '3.6.0-203');
		});

		it('returns the max-revision target version across multiple target artifacts (different OS / kernel variants)', async() => {
			stubReleaseWithArtifacts([
				'nvmesh-target-3.6.0-201.el8.x86_64.rpm',
				'nvmesh-target-3.6.0-205.el9.x86_64.rpm',
				'nvmesh-target-3.6.0-202.el8.aarch64.rpm'
			]);

			const result = await getDestinationTargetVersionAsync(DEST_RELEASE_NAME);

			assert.strictEqual(result, '3.6.0-205');
		});

		it('ignores non-target artifacts when picking the max revision', async() => {
			stubReleaseWithArtifacts([
				'nvmesh-management-9.9.0-999.el8.x86_64.rpm',
				'nvmesh-client-3.6.0-300.el8.x86_64.rpm',
				'nvmesh-target-3.6.0-203.el8.x86_64.rpm'
			]);

			const result = await getDestinationTargetVersionAsync(DEST_RELEASE_NAME);

			assert.strictEqual(result, '3.6.0-203');
		});

		it('rejects with CANNOT_FIND_ARTIFACTS when the release has no target artifact', async() => {
			stubReleaseWithArtifacts([
				'nvmesh-management-3.6.0-203.el8.x86_64.rpm',
				'nvmesh-client-3.6.0-203.el8.x86_64.rpm'
			]);

			await assert.rejects(
				getDestinationTargetVersionAsync(DEST_RELEASE_NAME),
				expectMessage(systemMessages.RELEASE_ARTIFACTS_NOT_FOUND.id));
		});

		it('rejects with RELEASE_NOT_FOUND when the destination release does not exist', async() => {
			releaseModule.getAllReleases = (_query, cb) => cb(null, []);

			await assert.rejects(
				getDestinationTargetVersionAsync('does-not-exist'),
				expectMessage(systemMessages.RELEASE_NOT_FOUND.id));
		});
	});

	describe('#executeSteps', function() {
		const origVerifyVolumeStateIsFresh = upgradeModule.verifyVolumeStateIsFresh;
		const origVerifyVolumesAvailability = upgradeModule.verifyVolumesAvailability;
		const origExecuteStep = upgradeModule.executeStep;
		const origVerifyLastMessageSent = upgradeModule.verifyLastMessageSent;

		let calls;

		before(async() => {
			await setup.newSetup(new SetupOptions().setEnableZones(true));
		});

		beforeEach(() => {
			resetStepIndex();
			calls = [];

			upgradeModule.verifyVolumeStateIsFresh = (upgrade, step, cb) => {
				calls.push({ fn: 'verifyVolumeStateIsFresh', stepID: step._id });
				cb();
			};
			upgradeModule.verifyVolumesAvailability = (upgrade, step, cb) => {
				calls.push({ fn: 'verifyVolumesAvailability', stepID: step._id });
				cb();
			};
			upgradeModule.executeStep = (step, cb) => {
				calls.push({ fn: 'executeStep', stepID: step._id });
				cb();
			};
			upgradeModule.verifyLastMessageSent = (step, cb) => {
				calls.push({ fn: 'verifyLastMessageSent', stepID: step._id });
				cb();
			};
		});

		afterEach(() => {
			upgradeModule.verifyVolumeStateIsFresh = origVerifyVolumeStateIsFresh;
			upgradeModule.verifyVolumesAvailability = origVerifyVolumesAvailability;
			upgradeModule.executeStep = origExecuteStep;
			upgradeModule.verifyLastMessageSent = origVerifyLastMessageSent;
		});

		it('skips both freshness and availability checks for non-volume-affecting steps', async() => {
			await executeStepsAsync(generateUpgrade(),
				[generateStep({ _id: 'mgmt-step', isVolumeAffected: 0 })]);

			assert.deepStrictEqual(
				calls.map(c => c.fn),
				['executeStep'],
				'volume gates must be bypassed when the step does not affect volumes');
		});

		it('runs freshness then availability before executing a volume-affecting step', async() => {
			await executeStepsAsync(generateUpgrade(),
				[generateStep({ _id: 'volume-step', isVolumeAffected: 1 })]);

			assert.deepStrictEqual(
				calls.map(c => c.fn),
				['verifyVolumeStateIsFresh', 'verifyVolumesAvailability', 'executeStep'],
				'order must be: freshness -> availability -> executeStep');
		});

		it('does not call verifyVolumesAvailability or executeStep when freshness rejects with a transient error', async() => {
			const step = generateStep({ _id: 'volume-step-stale', isVolumeAffected: 1 });
			await app.get('db').collection('upgradeStep').deleteMany({});
			await app.get('db').collection('upgradeStep').insertOne(Object.assign({}, step));

			const transientErr = {
				additionalInfo: { id: systemMessages.UPGRADE_STEP_CANNOT_BE_EXECUTED_VOLUME_STATE.id },
				toString: () => 'stale'
			};

			upgradeModule.verifyVolumeStateIsFresh = (u, s, cb) => {
				calls.push({ fn: 'verifyVolumeStateIsFresh', stepID: s._id });
				cb(transientErr);
			};

			await assert.rejects(
				executeStepsAsync(generateUpgrade(), [step]),
				(err) => err === transientErr);

			assert.deepStrictEqual(
				calls.map(c => c.fn),
				['verifyVolumeStateIsFresh'],
				'availability and step execution must be skipped on transient freshness error');

			const doc = await app.get('db').collection('upgradeStep').findOne({ _id: step._id });
			assert.strictEqual(doc.stepRetryCounter, 1,
				'handleStepCannotBeExecuted must increment the retry counter');
			assert.strictEqual(doc.lastExecTryError, 'stale');
		});

		it('propagates non-transient errors from the volume gates without bumping the retry counter', async() => {
			const step = generateStep({ _id: 'volume-step-fatal', isVolumeAffected: 1 });
			await app.get('db').collection('upgradeStep').deleteMany({});
			await app.get('db').collection('upgradeStep').insertOne(Object.assign({}, step));

			const fatalErr = {
				additionalInfo: { id: 999999 },
				toString: () => 'fatal'
			};

			upgradeModule.verifyVolumesAvailability = (u, s, cb) => {
				calls.push({ fn: 'verifyVolumesAvailability', stepID: s._id });
				cb(fatalErr);
			};

			await assert.rejects(
				executeStepsAsync(generateUpgrade(), [step]),
				(err) => err === fatalErr);

			assert.deepStrictEqual(
				calls.map(c => c.fn),
				['verifyVolumeStateIsFresh', 'verifyVolumesAvailability']);

			const doc = await app.get('db').collection('upgradeStep').findOne({ _id: step._id });
			assert.strictEqual(doc.stepRetryCounter, 0,
				'non-transient errors must not bump the retry counter');
		});

		it('reroutes IN_PROGRESS steps through verifyLastMessageSent and skips the gates', async() => {
			await executeStepsAsync(generateUpgrade(),
				[generateStep({ _id: 'in-progress-step', status: consts.upgradeStepStatuses.IN_PROGRESS })]);

			assert.deepStrictEqual(
				calls.map(c => c.fn),
				['verifyLastMessageSent']);
		});
	});
});

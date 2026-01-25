/*
 * SPDX-FileCopyrightText: Copyright (c) 2026 NVIDIA CORPORATION & AFFILIATES. All rights reserved.
 * SPDX-License-Identifier: Apache-2.0
 */

/* global app */

const async = require('async');
const uuid = require('uuid');
const events = require('../events.js');
const consts = require('../consts.js');
const utils = require('../utils.js');
const objectNotifier = require('../objectNotifier.js');
const systemMessages = require('../systemMessages.js');
const { Entities, SystemMessage, SystemAdminMessage, MongoError, Differentiators, InteropDBError } = require('../modules/error.js');
const kafkaModule = require('../modules/kafka.js');
const { UpgradeAgentCommand } = require('../models/kafkaMessages/UpgradeAgentCommand');
const volumeModule = require('../modules/volume.js');
const releaseModule = require('../modules/release.js');
const logger = require('../logger.js');

let checkUpgradeStatusTimeout;

const scope = {};

scope.getAllUpgrades = (queryObj, cb) => {
	utils.loadCollection('upgrade', queryObj, function(err, upgrades) {
		let error;

		if (err)
			error = new SystemAdminMessage(systemMessages.FAILED_TO_LOAD_UPGRADES).addInfo(Entities.Error, err);

		cb(error, upgrades);
	});
};

scope.getPossibleUpgrades = (sourceVersion, cb) => {
	const interopDB = app.get('interopDB');

	interopDB.getPossibleUpgrades(sourceVersion, (results) => {
		if (results.error)
			return cb(new SystemAdminMessage(systemMessages.FAILED_TO_LOAD_POSSIBLE_UPGRADES).addInfo(Entities.Error, new InteropDBError(results.error)));

		const releases = results.data;
		const possibleUpgrades = releases.map(r => r.release.version);

		cb(null, possibleUpgrades);
	});
};

function getInstallCommandArtifacts(machine, destinationVersion, cb) {
	const interopDB = app.get('interopDB');

	const {
		upgradeAgentData: {
			operatingSystem: { id, versionID },
			kernel,
			ofed,
			archType
		}
	} = machine;

	interopDB.getReleaseArtificatsForMachine(destinationVersion, id, versionID, kernel, ofed, archType, (results) => {
		if (results.error)
			return cb(new InteropDBError(results.error));

		if (!results.artifacts.length)
			return cb(new SystemMessage(systemMessages.UPGRADE_STEP_CANNOT_FIND_ARTIFACTS)
				.addInfo(Entities.Component.version, destinationVersion)
				.addInfo(Entities.UpgradeAgent.OSType, id)
				.addInfo(Entities.UpgradeAgent.OSVersion, versionID)
				.addInfo(Entities.UpgradeAgent.Kernel, kernel)
				.addInfo(Entities.UpgradeAgent.OFED, ofed)
				.addInfo(Entities.UpgradeAgent.ArchType, archType)
			);

		return cb(null, results.artifacts.map(a => a.name));
	});
}

function getCommandFromStep(machine, destinationVersion, step, cb) {
	function getCommand() {
		return {
			cmd: step.command,
			timeout: step.timeout,
			verificationCommand: step.verificationCommand,
			args: JSON.parse(step.arguments)
		};
	}

	if (step.command === consts.upgradeStepCommands.INSTALL)
		getInstallCommandArtifacts(machine, destinationVersion, (err, artifacts) => {
			if (err)
				return cb(err);

			const artifactsByComponent = {
				management: artifacts.filter(artifact => artifact.includes(consts.components.MANAGEMENT)),
				interopDB: artifacts.filter(artifact => artifact.includes(consts.components.INTEROP_DB)),
				target: artifacts.filter(artifact => artifact.includes(consts.components.TARGET)),
				upgradeAgent: artifacts.filter(artifact => artifact.includes(consts.components.UPGRADE_AGENT)),
				other: artifacts.filter(artifact =>
					!artifact.includes(consts.components.MANAGEMENT) &&
					!artifact.includes(consts.components.INTEROP_DB) &&
					!artifact.includes(consts.components.TARGET) &&
					!artifact.includes(consts.components.UPGRADE_AGENT))
			};

			const artifactsPerUpgradeType = {
				[consts.upgradeTypes.MANAGEMENT]: [...artifactsByComponent.management, ...artifactsByComponent.interopDB],
				[consts.upgradeTypes.UPGRADE_AGENT]: artifactsByComponent.upgradeAgent,
				[consts.upgradeTypes.CLIENT_ONLY]: artifactsByComponent.other,
				[consts.upgradeTypes.CLIENT_AND_TARGET]: [...artifactsByComponent.target, ...artifactsByComponent.other]
			};

			const upgradeStepArtifacts = artifactsPerUpgradeType[step.upgradeType];

			step.arguments = JSON.stringify(upgradeStepArtifacts);

			cb(null, getCommand());
		});
	else
		cb(null, getCommand());
}

function handleSteps(machine, destinationVersion, steps, cb) {
	const results = [];

	async.eachSeries(steps, (step, cb) => {
		getCommandFromStep(machine, destinationVersion, step, (err, command) => {
			if (err)
				return cb(err);

			results.push({
				command: command,
				isVolumeAffected: !!step.isVolumeAffected
			});

			cb();
		});
	}, (err) => {
		if (err)
			return cb(err);

		cb(null, results);
	});
}

function getBaseVersion(version) {
	return version?.split('-')[0];
}

function getComponentSteps(machine, component, sourceVersion, destinationVersion, upgradeType, cb) {
	const interopDB = app.get('interopDB');

	interopDB.getUpgradeScenario(
		component,
		sourceVersion,
		destinationVersion,
		(results) => {
			if (results.error)
				return cb(new InteropDBError(results.error));

			if (results.data && !results.data.length || !results.steps.length)
				return cb(new SystemMessage(systemMessages.UPGRADE_MISSING_SCENARIO)
					.addInfo(Entities.Upgrade.Type, upgradeType)
					.addInfo(Entities.Component.version, sourceVersion, Differentiators.Source)
					.addInfo(Entities.Component.version, destinationVersion, Differentiators.Destination)
				);

			const sortedSteps = results.steps.sort((a, b) => a.UpgradeToUpgradeStep.stepIndex - b.UpgradeToUpgradeStep.stepIndex);
			sortedSteps.forEach(step => step.upgradeType = upgradeType);

			handleSteps(machine, destinationVersion, sortedSteps, cb);
		});
}

const parseArtifactName = (artifactName) => {
	// Supports:
	//   nvmesh-base_3.3.0-3000.ubuntu2404.0.0_amd64.deb
	//   nvmesh-client-3.3.0-3000.el8_10.0.0.x86_64.rpm
	const match = artifactName.match(/^([^-_]+(?:-[^-_]+)*?)[_-](\d+\.\d+\.\d+)-(\d+)\./);
	if (!match) return null;
	return {
		packageName: match[1],
		baseVersion: match[2],
		releaseNumber: match[3]
	};
};

const isComponentVersionAlreadyInRelease = (component, componentVersion, release) => {
	const match = componentVersion.match(/^(\d+\.\d+\.\d+)-(\d+)/);
	if (!match) return false;
	const baseVersion = match[1];
	const releaseNumber = match[2];

	return release.artifacts.some(artifact => {
		if (!artifact.name) return false;

		const parsedArtifact = parseArtifactName(artifact.name);

		return parsedArtifact
			&& parsedArtifact.packageName === component
			&& parsedArtifact.baseVersion === baseVersion
			&& parseInt(parsedArtifact.releaseNumber, 10) === parseInt(releaseNumber, 10);
	});
};

const getReleaseByVersion = (version, cb) => {
	releaseModule.getAllReleases({ filter: { version }, sort: {}, skip: 0, limit: 1 }, (err, response) => {
		if (err) return cb(err);
		if (!response.length) return cb(new SystemAdminMessage(systemMessages.RELEASE_NOT_FOUND).addInfo(Entities.Release.version, version));
		cb(null, response[0]);
	});
};

const shouldSkipComponent = (component, componentVersion, destinationVersionRelease, hostname) => {
	const generalSettings = app.get('globalSettings');

	if (generalSettings.forceUpgradeUpToDateComponents) return false;

	if (isComponentVersionAlreadyInRelease(component, componentVersion, destinationVersionRelease)) {
		logger.sysDEBUG(`NDU - Skipping upgrade for machine: ${hostname}, component: ${component}-${componentVersion} `
			+ `because it is already in destination release ${destinationVersionRelease.version}`);
		return true;
	}
	return false;
};


scope.getUpgradeSteps = (upgrade, cb) => {
	async.waterfall([
		(cb) => {
			getReleaseByVersion(upgrade.destinationVersion, (err, release) => {
				if (err) return cb(err);
				cb(null, release);
			});
		},
		(destinationVersionRelease, cb) => {
			const steps = [];
			const mgmtSteps = [];
			const clientOnlySteps = [];

			async.eachSeries(upgrade.machinesToUpgrade, (machine, cb) => {
				const createSteps = (step, isClientOnly) => {
					step._id = uuid.v1();
					step.upgradeID = upgrade._id;
					step.hostname = machine.hostname;
					step.shouldStop = false;
					step.status = consts.upgradeStepStatuses.PENDING;
					step.startCondition = isClientOnly ? consts.upgradeStepStartConditions.NONE : consts.upgradeStepStartConditions.ALL_DONE;
					step.upgradeAgentToken = -1;
					step.messageSequence = -1;
				};

				async.series([
					(cb) => {
						const mgmtVersion = machine.upgradeAgentData.nvmeshVersions[consts.components.MANAGEMENT];
						const component = consts.components.MANAGEMENT;
						const sourceVersion = getBaseVersion(mgmtVersion);
						const upgradeType = consts.upgradeTypes.MANAGEMENT;

						if (!mgmtVersion || shouldSkipComponent(component, mgmtVersion, destinationVersionRelease, machine.hostname)) {
							return cb(null, []);
						}

						getComponentSteps(machine, component, sourceVersion, upgrade.destinationVersion, upgradeType, cb);
					},
					(cb) => {
						const upgradeAgentVersion = machine.upgradeAgentData.nvmeshVersions[consts.components.UPGRADE_AGENT];
						const component = consts.components.UPGRADE_AGENT;
						const sourceVersion = getBaseVersion(upgradeAgentVersion);
						const upgradeType = consts.upgradeTypes.UPGRADE_AGENT;

						if (!upgradeAgentVersion || shouldSkipComponent(component, upgradeAgentVersion, destinationVersionRelease, machine.hostname)) {
							return cb(null, []);
						}

						getComponentSteps(machine, component, sourceVersion, upgrade.destinationVersion, upgradeType, (err, steps) => {
							if (err && err.systemMessage?.id === systemMessages.UPGRADE_MISSING_SCENARIO.id) {
								logger.sysDEBUG(`got no upgrade agent upgrade scenario for machine: ${machine.hostname}, skipping...`);
								return cb(null, []);
							}
							cb(err, steps);
						});
					},
					(cb) => {
						machine.isClientOnly = !machine.upgradeAgentData.nvmeshVersions[consts.components.TARGET];
						const component = machine.isClientOnly ? consts.components.CLIENT : consts.components.TARGET;
						const componentVersion = machine.upgradeAgentData.nvmeshVersions[consts.components.CLIENT];
						const sourceVersion = getBaseVersion(componentVersion);
						const upgradeType = machine.isClientOnly ? consts.upgradeTypes.CLIENT_ONLY : consts.upgradeTypes.CLIENT_AND_TARGET;

						if (!componentVersion || shouldSkipComponent(consts.components.CLIENT, componentVersion, destinationVersionRelease, machine.hostname)) {
							return cb(null, []);
						}

						getComponentSteps(machine, component, sourceVersion, upgrade.destinationVersion, upgradeType, cb);
					},
				], (err, [managementSteps, upgradeAgentSteps, clientTargetSteps]) => {
					if (err)
						return cb(err);

					managementSteps.forEach(step => createSteps(step, false));
					upgradeAgentSteps.forEach(step => createSteps(step, false));
					clientTargetSteps.forEach(step => createSteps(step, machine.isClientOnly));

					mgmtSteps.push(...managementSteps);
					steps.push(...upgradeAgentSteps);

					if (machine.isClientOnly)
						clientOnlySteps.push(...clientTargetSteps);
					else
						steps.push(...clientTargetSteps);

					cb();
				});
			}, (err) => {
				if (err)
					return cb(err);

				// upgrading managements first
				const allSteps = [...mgmtSteps, ...steps, ...clientOnlySteps];
				allSteps.forEach((step, index) => step.stepIndex = index);

				if (!allSteps.length)
					return cb(new SystemMessage(systemMessages.UPGRADE_NO_STEPS_TO_EXECUTE));

				cb(null, allSteps);
			});
		}], (err, results) => {
		if (err)
			return cb(err);

		cb(null, results);
	});
};

scope.createUpgradeSteps = (upgrade, cb) => {
	const db = app.get('db');
	const collection = db.collection('upgradeStep');

	scope.getUpgradeSteps(upgrade, (err, steps) => {
		if (err)
			return cb(err);

		upgrade.stepsToComplete = steps.length;

		const updatedSteps = steps.map(step => ({ ...step, dateCreated: new Date() }));

		collection.insertMany(updatedSteps, cb);
	});
};

scope.createUpgrade = (upgrade, user, cb) => {
	upgrade._id = upgrade.uuid;
	upgrade.isPending = true;
	upgrade.modifiedBy = upgrade.createdBy = user.email;
	upgrade.dateModified = upgrade.dateCreated = new Date();
	upgrade.status = consts.upgradeStatuses.PENDING_START;
	upgrade.handledBy = utils.getHandlingMgmtParams();

	async.series([
		(cb) => {
			scope.enrichUpgradeAgents(upgrade, (err, upgradeAgents) => {
				if (err)
					return cb(new SystemAdminMessage(systemMessages.UPGRADE_SAVE_REQUEST_FAILED_CANNOT_GET_UPGRADE_AGENT)
						.addInfo(Entities.Error, err)
					);

				upgrade.machinesToUpgrade = upgradeAgents;

				cb();
			});
		},
		(cb) => {
			utils.insertToCollection(upgrade, 'upgrade', cb);
		},
		(cb) => {
			scope.createUpgradeSteps(upgrade, cb);
		},
		(cb) => {
			upgrade.isPending = false;

			utils.updateCollection([upgrade], 'upgrade', false, cb);
		}
	], (err) => {
		if (err)
			return cb([new SystemAdminMessage(systemMessages.UPGRADE_SAVE_REQUEST_FAILED).addInfo(Entities.Error, err)]);

		events.emitEvent([events.getUpgradeID(upgrade._id)], objectNotifier.events.newUpgradeEvent);

		if (upgrade.executionMode === consts.upgradeExecutionModes.AUTOMATIC)
			scope.tryToStartUpgrade(upgrade);

		cb([new SystemAdminMessage(systemMessages.UPGRADE_SAVED).addInfo(Entities.Upgrade.UUID, upgrade.uuid)]);
	});
};

scope.verifyUpgradeLock = (upgrade, cb) => {
	const db = app.get('db');
	const confCollection = db.collection('configurationVersion');

	confCollection.findOne({ _id: consts.CONFIG_VER_CLUSTER_ID }, { projection: { runningUpgrade: 1 } }, (err, clusterDoc) => {
		if (err)
			return cb(new MongoError(err).log());

		cb(null, clusterDoc &&
			clusterDoc.runningUpgrade &&
			clusterDoc.runningUpgrade.upgradeID === upgrade._id &&
			JSON.stringify(clusterDoc.runningUpgrade.createdBy) === JSON.stringify(utils.getHandlingMgmtParams())
		);
	});
};

scope.tryToTakeUpgradeLock = (upgrade, force, cb) => {
	const db = app.get('db');
	const confCollection = db.collection('configurationVersion');
	const query = {	_id: consts.CONFIG_VER_CLUSTER_ID };

	if (!force)
		query.runningUpgrade = { $exists: false };

	confCollection.findOneAndUpdate(query, [{
		$set: {
			runningUpgrade: {
				upgradeID: upgrade._id,
				createdBy: utils.getHandlingMgmtParams(),
				dateModified: '$$NOW'
			}
		}
	}], {
		returnDocument: consts.mongoReturnDocument.AFTER
	}, (err, clusterDoc) => {
		if (err)
			new MongoError(err).log();

		cb(err, clusterDoc);
	});
};

scope.releaseUpgradeLockByID = (upgradeIDs, cb) => {
	const db = app.get('db');
	const confCollection = db.collection('configurationVersion');

	confCollection.updateOne({
		_id: consts.CONFIG_VER_CLUSTER_ID,
		'runningUpgrade.upgradeID': { $in: upgradeIDs }
	}, {
		$unset: { runningUpgrade: 1 }
	}, cb);
};

scope.clearBreakpoint = (upgradeID, cb) => {
	const db = app.get('db');
	const collection = db.collection('upgradeStep');

	collection.findOneAndUpdate({
		upgradeID: upgradeID,
		isBreakpointSet: true
	}, {
		$set: { isBreakpointSet: false },
		$currentDate: { dateModified: true }
	}, { sort: { stepIndex: 1 } }, cb);
};

scope.resumeUpgrade = (upgrade, cb) => {
	const responses = [];
	let wasUnderLock;

	async.series([
		(cb) => {
			scope.verifyUpgradeLock(upgrade, (err, hasLock) => {
				if (err)
					return cb(new MongoError(err).log());

				wasUnderLock = hasLock;

				if (hasLock)
					return cb();

				//We might reach this function without a lock in case the upgrade reached failed state, and we manually set a step as completed
				//and resumed the upgrade
				scope.tryToTakeUpgradeLock(upgrade, false, (err, clusterDoc) => {
					let failed = err || !clusterDoc;

					if (failed)
						return cb(new SystemAdminMessage(systemMessages.UPGRADE_FAILED_TO_TAKE_LOCK));

					cb();
				});
			});
		},
		(cb) => {
			if (!wasUnderLock) {
				//If we were not under lock it means that we were not paused by breakpoint, so we shouldn't clear the next breakpoint.
				scope.startUpgrade(upgrade, true, () => {
					responses.push(new SystemMessage(systemMessages.UPGRADE_RESUMED).addInfo(Entities.Upgrade.UUID, upgrade.uuid));

					cb();
				});
			} else {
				scope.startUpgrade(upgrade, false, () => {
					scope.clearBreakpoint(upgrade._id, () => {
						scope.handleNextUpgradeStep(upgrade, () => {
							responses.push(new SystemMessage(systemMessages.UPGRADE_RESUMED).addInfo(Entities.Upgrade.UUID, upgrade.uuid));

							scope.checkUpgradeStatus(upgrade._id);

							cb();
						});
					});
				});
			}
		}
	], (err) => {
		cb(err ? [err] : responses);
	});
};

scope.skipFailedMachine = (upgrade, shouldPause, cb) => {
	const db = app.get('db');
	const upgradeStepCollection = db.collection('upgradeStep');
	let failedStep;

	async.series([
		(cb) => {
			upgradeStepCollection.findOne({
				upgradeID: upgrade._id,
				status: consts.upgradeStepStatuses.FAILED
			}, {
				sort: { stepIndex: 1 },
				projection: { stepIndex: 1, hostname: 1 }
			}, (err, step) => {
				if (err)
					return cb(new MongoError(err).log());

				if (!step)
					return cb(new SystemMessage(systemMessages.NO_FAILED_STEPS_TO_SKIP)
						.addInfo(Entities.Upgrade.ID, upgrade._id)
						.addInfo(Entities.Upgrade.UUID, upgrade._id));

				failedStep = step;

				cb();
			});
		},
		(cb) => {
			upgradeStepCollection.updateMany({
				upgradeID: upgrade._id,
				hostname: failedStep.hostname,
				stepIndex: { $gte: failedStep.stepIndex }
			}, {
				$set: { status: consts.upgradeStepStatuses.SKIPPED }
			}, {
				multi: true
			}, cb);
		},
		(cb) => {
			upgradeStepCollection.find({
				upgradeID: upgrade._id,
				hostname: failedStep.hostname,
				stepIndex: { $gte: failedStep.stepIndex }
			}).toArray((err, steps) => {
				if (err)
					return cb(new MongoError(err).log());

				steps.forEach(step => {
					events.emitEvent(
						[events.getUpgradeID(upgrade._id), events.getUpgradeStepID(step._id)],
						objectNotifier.events.upgradeStepStatusChangedEvent,
						step
					);
				});

				cb();
			});
		},
		(cb) => {
			return scope.updateUpgrade(upgrade._id, shouldPause, [failedStep.hostname], (err) => {
				if (err) return cb(err);

				cb();
			});
		}
	], (err) => {
		cb(err ? [err] : [new SystemMessage(systemMessages.UPGRADE_FAILED_MACHINE_SKIPPED)
			.addInfo(Entities.Upgrade.ID, upgrade._id).addInfo(Entities.Upgrade.UUID, upgrade._id)]);
	});
};

scope.startUpgrade = (upgrade, shouldHandleNextStep, cb) => {
	const db = app.get('db');
	const collection = db.collection('upgrade');

	collection.findOneAndUpdate({
		_id: upgrade._id
	}, {
		$set: {
			status: consts.upgradeStatuses.IN_PROGRESS
		},
		$currentDate: { dateModified: true }
	}, {
		returnDocument: consts.mongoReturnDocument.AFTER
	}, (err, upgradeDoc) => {
		if (err)
			new MongoError(err).log();

		if (upgradeDoc)
			events.emitEvent([events.getUpgradeID(upgradeDoc._id)], objectNotifier.events.upgradeStatusChangedEvent, upgradeDoc);

		if (shouldHandleNextStep)
			return scope.handleNextUpgradeStep(upgradeDoc, cb);

		cb(err);
	});
};

scope.updateStepResult = (commandResultMsg, cb) => {
	const db = app.get('db');
	const upgradeStepCollection = db.collection('upgradeStep');

	const payload = commandResultMsg.payload;

	upgradeStepCollection.findOneAndUpdate({
		_id: payload.upgradeStepID,
		$or: [
			{ upgradeAgentToken: { $lt: commandResultMsg.upgradeAgentToken } },
			{ upgradeAgentToken: commandResultMsg.upgradeAgentToken, messageSequence: { $lt: commandResultMsg.messageSequence } }
		]
	}, {
		$set: {
			status: payload.success ? consts.upgradeStepStatuses.COMPLETED : consts.upgradeStepStatuses.FAILED,
			response: payload
		},
		$unset: {
			lastExecTryError: 1
		},
		$currentDate: { dateModified: true }
	}, { returnDocument: consts.mongoReturnDocument.AFTER }, (err, results) => {
		if (err)
			return cb(new MongoError(err).log());

		if (results) {
			events.emitEvent(
				[events.getUpgradeID(results.upgradeID), events.getUpgradeStepID(results._id)],
				objectNotifier.events.upgradeStepStatusChangedEvent,
				results
			);

			if (results.status === consts.upgradeStepStatuses.FAILED) {
				handleFailedUpgradeStep(results, () => {});
			} else {
				utils.callFunctionWithDebouncer(() => {
					scope.checkUpgradeStatus(results.upgradeID);
				}, `checkUpgradeStatus_${results.upgradeID}`, 1000);
			}
		}

		cb();
	});
};

function handleFailedUpgradeStep(step, cb) {
	const db = app.get('db');
	const upgradeCollection = db.collection('upgrade');
	let upgrade;

	async.series([
		(cb) => {
			upgradeCollection.findOne({ _id: step.upgradeID }, (err, upgradeDoc) => {
				if (err) return cb(new MongoError(err).log());

				upgrade = upgradeDoc;

				cb();
			});
		},
		(cb) => {
			if (upgrade.skipMachinesOnFailure && (!upgrade.skippedMachines || upgrade.skippedMachines?.length < upgrade.maxErrorsThreshold)) {
				scope.skipFailedMachine(upgrade, false, () => {
					scope.handleNextUpgradeStep(upgrade, cb);
				});
			} else {
				scope.handleUpgradeCompletion(upgrade._id, cb);
			}
		}
	], (err) => {
		cb(err);
	});
}

scope.executeStep = (step, callback) => {
	const db = app.get('db');
	const upgradeStepCollection = db.collection('upgradeStep');

	let upgradeAgent = {};
	let upgradeAgentTopicName;
	let updatedStep = {};

	async.series([
		(cb) => {
			scope.fetchUpgradeAgentByHostname(step.hostname, (err, upgradeAgentDoc) => {
				if (err) return cb(err);

				upgradeAgent = upgradeAgentDoc;
				upgradeAgentTopicName = upgradeAgent.topics[consts.topicSuffix.UPGRADE_AGENT_COMMANDS];

				cb();
			});
		},
		(cb) => {
			upgradeStepCollection.findOneAndUpdate({
				_id: step._id,
				isBreakpointSet: { $ne: true },
				status: consts.upgradeStepStatuses.PENDING
			}, {
				$set: {
					status: consts.upgradeStepStatuses.PENDING_SEND
				},
				$currentDate: { dateModified: true }
			}, (err, stepDoc) => {
				if (err) {
					new MongoError(err).log();

					return cb(err);
				}

				let shouldStop;

				if (!stepDoc)
					//Unfortunatelly we have to check again.
					return upgradeStepCollection.findOne({ _id: step._id }, (err, stepDoc) => {
						if (err) {
							new MongoError(err).log();

							return cb(err);
						}

						if (stepDoc.isBreakpointSet)
							shouldStop = new SystemMessage(systemMessages.UPGRADE_STEP_CANNOT_BE_EXECUTED_UPGRADE_PAUSED);

						cb(shouldStop || true);
					});

				cb(shouldStop);
			});
		},
		(cb) => {
			const message = new UpgradeAgentCommand(upgradeAgent._id, upgradeAgent.upgradeAgentToken, step);

			kafkaModule.sendMessages(
				upgradeAgent.topics[consts.topicSuffix.UPGRADE_AGENT_COMMANDS],
				[message],
				cb
			);
		},
		(cb) => {
			upgradeStepCollection.findOneAndUpdate({
				_id: step._id,
				status: consts.upgradeStepStatuses.PENDING_SEND
			}, {
				$set: {
					status: consts.upgradeStepStatuses.IN_PROGRESS,
					lastMessageSent: {
						topic: upgradeAgentTopicName,
						upgradeAgentToken: upgradeAgent.upgradeAgentToken
					}
				},
				$currentDate: { dateModified: true }
			}, {
				returnDocument: consts.mongoReturnDocument.AFTER
			}, (err, stepDoc) => {
				if (err) {
					new MongoError(err).log();

					return cb(err);
				}

				if (!stepDoc)
					return cb(true);

				updatedStep = stepDoc;

				events.emitEvent(
					[events.getUpgradeID(updatedStep.upgradeID), events.getUpgradeStepID(updatedStep._id)],
					objectNotifier.events.upgradeStepStatusChangedEvent,
					updatedStep
				);

				cb();
			});
		}
	], (err) => {
		callback(err === true ? null : err, updatedStep);
	});
};

scope.fetchUpgradeAgentByHostname = (hostname, cb) => {
	const db = app.get('db');
	const upgradeAgentCollection = db.collection('upgradeAgent');

	upgradeAgentCollection.findOne({
		_id: hostname
	}, (err, upgradeAgentDoc) => {
		let error;

		if (err)
			error = new MongoError(err).log();

		if (err || !upgradeAgentDoc)
			error = err
				? err
				: new SystemMessage(systemMessages.UPGRADE_AGENT_NOT_FOUND).addInfo(Entities.UpgradeAgent.ID, hostname);

		cb(error, upgradeAgentDoc);
	});
};

scope.enrichUpgradeAgents = (saveUpgradeRequest, cb) => {
	const enrichedMachinesToUpgrade = [];

	async.eachSeries(saveUpgradeRequest.machinesToUpgrade, (hostname, cb) => {
		scope.fetchUpgradeAgentByHostname(hostname, (err, upgradeAgentDoc) => {
			if (err) return cb(err);

			enrichedMachinesToUpgrade.push(upgradeAgentDoc);

			cb();
		});
	}, (err) => {
		cb(err, enrichedMachinesToUpgrade);
	});
};

scope.handleNextUpgradeStep = (upgrade, cb) => {
	const db = app.get('db');
	const upgradeStepCollection = db.collection('upgradeStep');
	const stepsToExecute = [];
	const stepsPerMachine = {};

	let hasRemainingSteps;

	const stepsCursor = upgradeStepCollection.find({
		upgradeID: upgrade._id,
		status: { $in: [consts.upgradeStepStatuses.PENDING, consts.upgradeStepStatuses.IN_PROGRESS, consts.upgradeStepStatuses.FAILED] }
	}, {
		sort: {
			stepIndex: 1
		}
	});

	function addStepForExecution(step, callback) {
		if (!stepsPerMachine[step.hostname])
			stepsPerMachine[step.hostname] = [];

		stepsPerMachine[step.hostname].push(step);

		stepsToExecute.push(step);

		callback();
	}

	utils.asyncIterCursor(stepsCursor, (step, callback) => {
		if (step.status === consts.upgradeStepStatuses.FAILED) return callback(true);

		hasRemainingSteps = true;

		if (step.isBreakpointSet)
			return callback(new SystemMessage(systemMessages.UPGRADE_STEP_CANNOT_BE_EXECUTED_HIT_BREAKPOINT)
				.addInfo(Entities.UpgradeStep.ID, step._id));

		if (step.status === consts.upgradeStepStatuses.PENDING) {
			if (step.startCondition === consts.upgradeStepStartConditions.ALL_DONE ||
				step.startCondition === consts.upgradeStepStartConditions.PREVIOUS_DONE) {
				if (stepsToExecute.length === 0)
					addStepForExecution(step, callback);
				else callback(true); //No reason to continue to interate.
			} else if (step.startCondition === consts.upgradeStepStartConditions.NONE) {
				if (Object.keys(stepsPerMachine).length >= upgrade.maxConcurrentClients)
					return callback(true);

				if (!stepsPerMachine[step.hostname]?.length)
					addStepForExecution(step, callback);
				else callback(); //This step can't be executed currently, as we already have one command for that upgrade agent. We can still continue.
			}
		} else if (step.status === consts.upgradeStepStatuses.IN_PROGRESS) {
			addStepForExecution(step, callback);
		}
	}, (iterError) => {
		if (!hasRemainingSteps)
			return scope.handleUpgradeCompletion(upgrade._id, cb);

		scope.executeSteps(upgrade, stepsToExecute, (err) => {
			if (shouldUpgradeBePaused(err) || shouldUpgradeBePaused(iterError)) {
				return scope.updateUpgrade(upgrade._id, true, [], cb);
			}
			cb(err);
		});
	});
};

scope.updateUpgrade = (upgradeID, shouldPause, skippedMachines, cb) => {
	const db = app.get('db');
	const upgradeCollection = db.collection('upgrade');
	const $update = {};

	if (shouldPause)
		$update.$set = { status: consts.upgradeStatuses.PAUSED };

	if (skippedMachines.length)
		$update.$addToSet = { skippedMachines: { $each: skippedMachines } };

	upgradeCollection.findOneAndUpdate({
		_id: upgradeID
	}, $update, {
		returnDocument: consts.mongoReturnDocument.AFTER
	}, (err, upgradeDoc) => {
		if (err)
			return cb(new MongoError(err).log());

		if (upgradeDoc) {
			events.emitEvent([events.getUpgradeID(upgradeDoc._id)], objectNotifier.events.upgradeStatusChangedEvent, upgradeDoc);

			cb();
		}
	});
};

function shouldUpgradeBePaused(err) {
	return (err instanceof SystemMessage &&
		[systemMessages.UPGRADE_STEP_CANNOT_BE_EXECUTED_HIT_BREAKPOINT.id, systemMessages.UPGRADE_STEP_CANNOT_BE_EXECUTED_UPGRADE_PAUSED.id]
			.includes(err.additionalInfo.id));
}

scope.verifyVolumesAvailability = (upgrade, step, cb) => {
	const db = app.get('db');
	const volumeCollection = db.collection('volume');

	if (upgrade.minRedundancyLevel === consts.upgradeRedundancyLevels.NONE)
		return cb();

	volumeCollection.aggregate([{
		$match: {
			RAIDLevel: {
				$in: ['Mirrored RAID-1', 'Striped & Mirrored RAID-10', 'Erasure Coding', 'Striped Erasure Coding']
			},
			'chunks.pRaids.diskSegments.node_id': step.hostname
		}
	}, {
		$project: {
			'RAIDLevel': 1,
			'parityBlocks': 1,
			'status': 1,
			'action': 1,
			'chunks.pRaids.diskSegments.isDead': 1,
			'chunks.pRaids.diskSegments.status': 1,
			'chunks.pRaids.diskSegments.type': 1,
			'chunks.pRaids.diskSegments.node_id': 1,
			'chunks.pRaids.uuid': 1
		}
	},
	{ $unwind: '$chunks' },
	{ $unwind: '$chunks.pRaids' },
	{ $match: { 'chunks.pRaids.diskSegments.node_id': step.hostname } },
	{ $unwind: '$chunks.pRaids.diskSegments' },
	{ $match: { 'chunks.pRaids.diskSegments.type': consts.segmentTypes.DATA } },
	{
		$group: {
			_id: '$chunks.pRaids.uuid',
			volumeID: { $first: '$_id' },
			RAIDLevel: { $first: '$RAIDLevel' },
			parityBlocks: { $first: '$parityBlocks' },
			status: { $first: '$status' },
			action: { $first: '$action' },
			numOfDeadSegments: {
				$sum: {
					$cond: [
						{
							$and: [
								{
									$or: [
										{ $ne: ['$chunks.pRaids.diskSegments.status', consts.diskSegmentStatuses.NORMAL] },
										{ $eq: ['$chunks.pRaids.diskSegments.isDead', true] }
									],
								},
								{ $ne: ['$chunks.pRaids.diskSegments.node_id', step.hostname] }
							]
						},
						1,
						0
					]
				}
			},
			numOfOwnHealthySegments: {
				$sum: {
					$cond: [
						{
							$and: [
								{ $eq: ['$chunks.pRaids.diskSegments.node_id', step.hostname] },
								{ $eq: ['$chunks.pRaids.diskSegments.status', consts.diskSegmentStatuses.NORMAL] },
								{ $ne: ['$chunks.pRaids.diskSegments.isDead', true] },
							]
						},
						1,
						0
					]
				}
			}
		},
	}]).toArray((err, pRaidsWithDeadSegments) => {
		if (err)
			return cb(new MongoError(err).log());

		let error;

		pRaidsWithDeadSegments.forEach(pRaid => {
			if (error) return;

			if (pRaid.status === consts.volumeStatuses.OFFLINE && pRaid.action === consts.volumeActions.BOOTING)
				return;

			if (pRaid.RAIDLevel === consts.RAIDLevel.ERASURE_CODING ||
				pRaid.RAIDLevel === consts.RAIDLevel.STRIPED_ERASURE_CODING) {
				if (pRaid.numOfDeadSegments && upgrade.minRedundancyLevel === consts.upgradeRedundancyLevels.MAX)
					error = new SystemMessage(systemMessages.UPGRADE_STEP_CANNOT_BE_EXECUTED_REDUNDANCY_WILL_BE_VIOLATED);
				else if (pRaid.numOfDeadSegments + pRaid.numOfOwnHealthySegments > pRaid.parityBlocks)
					error = new SystemMessage(systemMessages.UPGRADE_STEP_CANNOT_BE_EXECUTED_UNHEALTHY_PRAID);
			} else { //RAID 1 or 10
				if (pRaid.numOfDeadSegments)
					error = new SystemMessage(systemMessages.UPGRADE_STEP_CANNOT_BE_EXECUTED_UNHEALTHY_PRAID);
			}

			if (error)
				error
					.addInfo(Entities.Volume.ID, pRaid.volumeID)
					.addInfo(Entities.PRaid.UUID, pRaid._id)
					.addInfo(Entities.Upgrade.UUID, upgrade._id)
					.addInfo(Entities.UpgradeStep.ID, step._id);
		});

		cb(error);
	});
};

scope.handleStepCannotBeExecuted = (step, err, cb) => {
	const db = app.get('db');
	const upgradeStepCollection = db.collection('upgradeStep');

	upgradeStepCollection.findOneAndUpdate({
		_id: step._id,
		status: consts.upgradeStepStatuses.PENDING,
		$or: [
			{ stepRetryCounter: step.stepRetryCounter },
			{ stepRetryCounter: { $exists: false } }
		]
	}, {
		$inc: { stepRetryCounter: 1 },
		$set: { lastExecTryError: err }
	}, cb);
};

scope.verifyLastMessageSent = (step, cb) => {
	const db = app.get('db');
	const upgradeAgentCollection = db.collection('upgradeAgent');

	upgradeAgentCollection.findOne({
		_id: step.hostname
	}, { projection: { upgradeAgentToken: 1 } }, (err, upgradeAgentDoc) => {
		if (err)
			return cb(new MongoError(err).log());

		if (upgradeAgentDoc.upgradeAgentToken !== step.lastMessageSent.upgradeAgentToken)
			return scope.executeStep(step, cb);

		cb();
	});
};

scope.transientUpgradeErrors = [
	systemMessages.UPGRADE_STEP_CANNOT_BE_EXECUTED_UNHEALTHY_PRAID.id,
	systemMessages.UPGRADE_STEP_CANNOT_BE_EXECUTED_REDUNDANCY_WILL_BE_VIOLATED.id
];

scope.executeSteps = (upgrade, steps, cb) => {
	async.eachSeries(steps, (step, cb) => {
		if (step.status === consts.upgradeStepStatuses.IN_PROGRESS)
			return scope.verifyLastMessageSent(step, () => cb());

		async.series([
			(cb) => {
				//Verify that we can execute the step.
				if (step.isVolumeAffected)
					return scope.verifyVolumesAvailability(upgrade, step, (err) => {
						if (err && scope.transientUpgradeErrors.includes(err.additionalInfo.id))
							return scope.handleStepCannotBeExecuted(step, err, () => cb(err));

						return cb(err);
					});

				cb();
			},
			(cb) => {
				scope.executeStep(step, (err) => {
					cb(err);
				});
			}
		], cb);
	}, (err) => {
		cb(err);
	});
};

scope.handleUpgradeCompletion = (upgradeID, cb) => {
	const db = app.get('db');
	const upgradeStepCollection = db.collection('upgradeStep');
	const upgradeCollection = db.collection('upgrade');
	let isUpgradeFailed = false;
	let response;

	async.waterfall([
		(cb) => {
			upgradeStepCollection.countDocuments({
				upgradeID: upgradeID,
				status: { $nin: consts.completedUpgradeStepStatuses }
			}, cb);
		},
		(count, cb) => {
			isUpgradeFailed = count > 0;

			upgradeCollection.findOneAndUpdate({
				_id: upgradeID
			}, {
				$set: { status: isUpgradeFailed ? consts.upgradeStatuses.FAILED : consts.upgradeStatuses.COMPLETED },
				$currentDate: { dateModified: true }
			}, {
				returnDocument: consts.mongoReturnDocument.AFTER
			}, cb);
		}
	], (err, upgradeDoc) => {
		if (err)
			return cb(new MongoError(err).log());

		clearTimeout(checkUpgradeStatusTimeout);

		if (upgradeDoc) {
			events.emitEvent([events.getUpgradeID(upgradeDoc._id)], objectNotifier.events.upgradeStatusChangedEvent, upgradeDoc);

			if (isUpgradeFailed)
				response = new SystemAdminMessage(systemMessages.UPGRADE_FAILED).addInfo(Entities.Upgrade.UUID, upgradeID);
		}

		scope.releaseUpgradeLockByID([upgradeID], (err) => {
			cb(err || response);
		});
	});
};

scope.checkUpgradeStatus = (upgradeID) => {
	const db = app.get('db');
	const upgradeCollection = db.collection('upgrade');

	let keepChecking = true;
	let upgrade;

	async.series([
		(cb) => {
			upgradeCollection.findOne({ _id: upgradeID }, (err, upgradeDoc) => {
				if (err)
					return cb(new MongoError(err).log());

				upgrade = upgradeDoc;

				cb();
			});
		},
		(cb) => {
			if (upgrade && upgrade.status === consts.upgradeStatuses.IN_PROGRESS)
				return scope.handleNextUpgradeStep(upgrade, (err) => {
					if (shouldUpgradeBePaused(err)) {
						keepChecking = false;

						cb();
					}

					cb(err);
				});

			keepChecking = false;

			cb();
		}
	], () => {
		if (keepChecking) {
			if (checkUpgradeStatusTimeout)
				clearTimeout(checkUpgradeStatusTimeout);

			checkUpgradeStatusTimeout = setTimeout(() => scope.checkUpgradeStatus(upgrade._id), consts.UPGRADE_STATUS_CHECK_INTERVAL);
		}
	});
};

scope.startUpgradeByID = (upgradeID, cb) => {
	utils.fetchEntityByID(consts.dbCollections.UPGRADE, upgradeID, false, {}, (err, upgrade) => {
		if (err)
			return cb([err.addInfo(Entities.Upgrade.UUID, upgradeID)]);

		scope.tryToStartUpgrade(upgrade, cb);
	});
};

scope.tryToStartUpgrade = (upgrade, cb) => {
	async.series([
		(cb) => {
			preUpgradeChecks(upgrade, cb);
		},
		(cb) => {
			scope.tryToTakeUpgradeLock(upgrade, false, (err, clusterDoc) => {
				let failed = err || !clusterDoc;

				if (failed)
					return cb(new SystemAdminMessage(systemMessages.UPGRADE_FAILED_TO_TAKE_LOCK));

				cb();
			});
		},
		(cb) => {
			scope.startUpgrade(upgrade, true, (err) => {
				if (!err || scope.transientUpgradeErrors.includes(err.additionalInfo.id))
					scope.checkUpgradeStatus(upgrade._id);

				cb(err && new SystemAdminMessage(systemMessages.UPGRADE_FAILED_TO_START)
				);
			});
		}
	], (err) => {
		let response;

		if (err)
			response = err;
		else
			response = new SystemAdminMessage(systemMessages.UPGRADE_STARTED);

		if (cb)
			cb([response.addInfo(Entities.Upgrade.UUID, upgrade.uuid)]);
	});
};

scope.deleteUpgrades = (upgrades, cb) => {
	async.series([
		(cb) => {
			utils.deleteFromCollectionByQuery({ upgradeID: { $in: upgrades.map(upgrade => upgrade._id) } }, 'upgradeStep', cb);
		},
		(cb) => {
			utils.deleteFromCollection(upgrades, 'upgrade', false, cb);
		},
		(cb) => {
			scope.releaseUpgradeLockByID(upgrades.map(upgrade => upgrade._id), cb);
		}
	], (err) => {
		let responses;

		if (err)
			responses = (upgrades.map(upgrade => new SystemAdminMessage(systemMessages.UPGRADE_DELETE_REQUEST_FAILED)
				.addInfo(Entities.Error, err)
				.addInfo(Entities.Upgrade.UUID, upgrade.uuid)));
		else {
			responses = (upgrades.map(upgrade => new SystemAdminMessage(systemMessages.UPGRADE_DELETED)
				.addInfo(Entities.Upgrade.UUID, upgrade.uuid)));

			events.emitEvent(upgrades.map(upgrade => events.getUpgradeID(upgrade._id)), objectNotifier.events.upgradeRemovedEvent);
		}

		cb(responses);
	});
};

// pre-upgrade checks includes:
// - verify all nvmesh components are in the same version
// - verify compatibility with other components
// - verify compatibility with the environment (3rdPartyLibraries)
// - verify all targets and clients are up
// - verify all volumes are in healthy state
// - verify no other upgrades are running (check happens via tryToTakeUpgradeLock in tryToStartUpgrade)
function preUpgradeChecks(upgrade, callback) {
	let skip;

	async.waterfall([
		// Validate MongoDB information on NVMesh components (client/target/upgradeAgent)
		(cb) => {
			getPreUpgradeComponentsData(upgrade, (err, componentsInformation) => {
				if (err)
					return cb(err);

				if (Object.values(componentsInformation).every(component => !component)) {
					logger.sysDEBUG('Skipping pre-upgrade checks - no upgrade related components found in the cluster');
					skip = true;
					return cb(null, {});
				}

				const error = validatePreUpgradeCheckComponentsData(componentsInformation);
				if (error)
					return cb(error);

				// componentsInformation[componentName] can be undefined if no components of this type are found in the cluster
				const dbVersions = {
					client: componentsInformation.client?.versions?.[0],
					target: componentsInformation.target?.versions?.[0],
					upgradeAgent: componentsInformation.upgradeAgent?.versions?.[0],
					librdkafka: componentsInformation.upgradeAgent?.librdkafkaVersions
				};

				cb(null, dbVersions);
			});
		},
		// Validate InteropDB + MongoDB information on NVMesh components (management/client/target/upgradeAgent)
		(dbVersions, cb) => {
			if (skip) return cb();

			async.parallel([
				(parallelCb) => validateComponentsVersionsCompatibilities(dbVersions, parallelCb),
				(parallelCb) => validateThirdPartyLibsCompatibilities(dbVersions, parallelCb)
			], err => cb(err));
		},
		// Validate all volumes are healthy
		(cb) => {
			if (skip || consts.preUpgradeCheckRelaxationsMode.skipVolumeStatusCheck) return cb();

			volumeModule.getAllVolumes({ _id: 1 }, 0, 1, { health: { $ne: consts.targetHealth.HEALTHY } }, {}, (err, unhealthyVolumes) => {
				if (err)
					return cb(err);

				if (unhealthyVolumes.length)
					return cb(new SystemMessage(systemMessages.NOT_ALL_VOLUMES_ARE_HEALTHY).addInfo(Entities.Volume.ID, unhealthyVolumes[0]._id));

				cb();
			});
		}
	], (error) => {
		if (error)
			return handlePreUpgradeCheckFailure(upgrade, error, callback);

		callback();
	});
}

// return an aggregations of all versions, healths and librdkafka versions (for upgradeAgent) for a given collection
// example of payload returned:
// {
// 		"upgradeAgent": {
// 			"versions": ["3.1.0-1406-SIM"],
// 			"unhealthy": [],
// 			"librdkafkaVersions": ["2.6.0"]
// 		},
// 		"target": {
// 			"versions": ["3.1.0-1406-SIM"],
// 			"unhealthy": ["scale-1","scale-2"]
// 		},
// }
function getPreUpgradeComponentsData(upgrade, callback) {
	const hostnamesToUpgrade = upgrade.machinesToUpgrade.map(machine => machine.hostname);
	const $match = { _id: { $in: hostnamesToUpgrade } };

	async.parallel({
		client: (cb) => {
			const { $project, $group } = getPreUpgradeComponentDataPipelineStagesForClient();
			getPreUpgradeComponentData(consts.dbCollections.CLIENT, $match, $project, $group, cb);
		},
		target: (cb) => {
			const { $project, $group } = getPreUpgradeComponentDataPipelineStagesForTarget();
			getPreUpgradeComponentData(consts.dbCollections.TARGET, $match, $project, $group, cb);
		},
		upgradeAgent: (cb) => {
			const { $project, $group } = getPreUpgradeComponentDataPipelineStagesForUpgradeAgent();
			getPreUpgradeComponentData(consts.dbCollections.UPGRADE_AGENT, $match, $project, $group, cb);
		}
	}, callback);
}

function getPreUpgradeComponentDataPipelineStagesForClient() {
	const versionPath = 'version';
	const healthPath = 'health';

	return {
		$project: getPreUpgradeComponentDataProject(versionPath, healthPath),
		$group: getPreUpgradeComponentDataGroup(versionPath, healthPath, undefined, !consts.preUpgradeCheckRelaxationsMode.allowAlarmClients),
	};
}

function getPreUpgradeComponentDataPipelineStagesForTarget() {
	const versionPath = 'version';
	const healthPath = 'health';

	return {
		$project: getPreUpgradeComponentDataProject(versionPath, healthPath),
		$group: getPreUpgradeComponentDataGroup(versionPath, healthPath),
	};
}

function getPreUpgradeComponentDataPipelineStagesForUpgradeAgent() {
	const versionPath = 'upgradeAgentData.version';
	const healthPath = 'health';
	const librdkafkaPath = 'upgradeAgentData.librdkafkaVersion';

	return {
		$project: getPreUpgradeComponentDataProject(versionPath, healthPath, librdkafkaPath),
		$group: getPreUpgradeComponentDataGroup(versionPath, healthPath, librdkafkaPath),
	};
}

function getPreUpgradeComponentDataProject(versionPath, healthPath, librdkafkaPath) {
	const $project = {
		[versionPath]: 1,
		[healthPath]: 1,
	};

	if (librdkafkaPath)
		$project[librdkafkaPath] = 1;

	return $project;
}

function getPreUpgradeComponentDataGroup(versionPath, healthPath, librdkafkaPath, includeAlarmAsUnhealthy = true) {
	const unhealthyCondition = includeAlarmAsUnhealthy
		? { $ne: [`$${healthPath}`, consts.targetHealth.HEALTHY] }
		: { $eq: [`$${healthPath}`, consts.targetHealth.CRITICAL] };

	const $group = {
		_id: null,
		versions: { $addToSet: `$${versionPath}` },
		unhealthy: {
			$push: {
				$cond: {
					if: unhealthyCondition,
					then: '$_id',
					else: '$$REMOVE'
				}
			}
		}
	};

	if (librdkafkaPath)
		$group.librdkafkaVersions = { $addToSet: `$${librdkafkaPath}` };

	return $group;
}

function getPreUpgradeComponentData(collectionName, $match, $project, $group, callback) {
	const db = app.get('db');
	const collection = db.collection(collectionName);
	const pipeline = [
		{ $match },
		{ $project },
		{ $group },
		{ $project: { _id: 0 } }
	  ];

	collection.aggregate(pipeline).toArray((err, res) => {
		if (err)
			return callback(new MongoError(err).log());

		callback(null, res[0]);
	});
}

function handlePreUpgradeCheckFailure(upgrade, error, callback) {
	const db = app.get('db');
	const upgradeCollection = db.collection('upgrade');
	const $set = {
		status: consts.upgradeStatuses.PRE_UPGRADE_CHECKS_FAILED,
		dateModified: new Date()
	};

	upgradeCollection.updateOne({ _id: upgrade._id }, { $set }, (err) => {
		if (err)
			return callback(new MongoError(err).log());

		events.emitEvent([events.getUpgradeID(upgrade._id)], objectNotifier.events.upgradeStatusChangedEvent, {
			...upgrade,
			status: consts.upgradeStatuses.PRE_UPGRADE_CHECKS_FAILED
		});

		callback(new SystemAdminMessage(systemMessages.PRE_UPGRADE_CHECKS_FAILED)
			.addInfo(Entities.Upgrade.ID, upgrade._id)
			.addInfo(Entities.Error, error).log());
	});
}

function validatePreUpgradeCheckComponentsData(componentsInformation) {
	const { componentsWithMultipleVersions, componentsWithUnhealthy } = Object.entries(componentsInformation)
		.filter(([, info]) => info)
		.reduce((acc, [component, { versions, unhealthy }]) => {
			if (versions.length > 1)
				acc.componentsWithMultipleVersions.push(component);

			if (unhealthy && unhealthy.length > 0)
				acc.componentsWithUnhealthy.push({ component, unhealthy });

			return acc;
		},
		{ componentsWithMultipleVersions: [], componentsWithUnhealthy: [] });

	if (componentsWithMultipleVersions.length) {
		const error = new SystemMessage(systemMessages.NOT_ALL_NVMESH_COMPONENTS_ARE_IN_THE_SAME_VERSION);
		componentsWithMultipleVersions.forEach(component => error.addInfo(Entities.Component.componentType, component));
		return error;
	}

	if (componentsWithUnhealthy.length) {
		const error = new SystemMessage(systemMessages.NOT_ALL_NVMESH_COMPONENTS_ARE_IN_HEALTHY_STATE);
		componentsWithUnhealthy.forEach(({ component, unhealthy }) => {
			error.addInfo(Entities.Component.componentType, component);
			error.addInfo(Entities.Component.ID, unhealthy[0]._id);
			error.addInfo(Entities.Component.health, unhealthy[0].health);
		});
		return error;
	}
}

// this function is used to validate all of the given nvmesh components versions are compatible one with the other based on the interopDB
function validateComponentsVersionsCompatibilities(componentsVersions, mainCallback) {
	const interopDB = app.get('interopDB');
	const versions = {
		[consts.components.MANAGEMENT]: utils.getVRPartsObj(app.get('rpmVersion')).version,
		[consts.components.CLIENT]: componentsVersions.client ? utils.getVRPartsObj(componentsVersions.client).version : null,
		[consts.components.TARGET]: componentsVersions.target ? utils.getVRPartsObj(componentsVersions.target).version : null,
		[consts.components.UPGRADE_AGENT]: componentsVersions.upgradeAgent ? utils.getVRPartsObj(componentsVersions.upgradeAgent).version : null
	};

	// filter out components with no version
	const versionsEntries = Object.entries(versions).filter(([, version]) => version);

	async.each(versionsEntries, ([name, version], callback) => {
		async.waterfall([
			(cb) => {
				interopDB.getRequirements(name, version, results => {
					if (results.error) {
						return cb(new SystemMessage(systemMessages.INTEROPDB_GET_REQUIREMENTS_FAILED)
							.addInfo(Entities.Component.name, name)
							.addInfo(Entities.Component.version, version)
							.addInfo(Entities.Error, new InteropDBError(results.error)));
					}

					const allRequirements = results.data || [];
					// keep only the components we want to check compatibility with
					const requirements = allRequirements.filter(requirementName => requirementName !== name && versions[requirementName]);
					cb(null, requirements);
				});
			},
			(requirements, cb) => {
				if (!requirements.length)
					return cb(null, null, requirements);

				interopDB.getCompatibilities(name, consts.componentTypes.NVMESH_PACKAGE, version, results => {
					if (results.error) {
						return cb(new SystemMessage(systemMessages.INTEROPDB_GET_COMPATIBILITIES_FAILED)
							.addInfo(Entities.Component.name, name)
							.addInfo(Entities.Component.version, version)
							.addInfo(Entities.Error, new InteropDBError(results.error)));
					}

					const compatibilities = results.data || {};
					cb(null, compatibilities, requirements);
				});
			},
			(compatibilities, requirements, cb) => {
				if (!requirements.length)
					return cb();

				if (!Object.keys(compatibilities).length) {
					const error = new SystemMessage(systemMessages.REQUIRED_COMPATIBILITIES_NOT_FOUND)
						.addInfo(Entities.Component.name, name)
						.addInfo(Entities.Component.version, version);
					requirements.forEach(requirement => error.addInfo(Entities.Component.requirement, requirement));
					return cb(error);
				}

				async.each(requirements, (requiredComponent, eachCb) => {
					const requiredComponentVersion = versions[requiredComponent];
					const isCompatible = compatibilities[requiredComponent] && compatibilities[requiredComponent].includes(requiredComponentVersion);

					if (!isCompatible)
						return eachCb(new SystemMessage(systemMessages.COMPONENTS_VERSIONS_NOT_COMPATIBLE)
							.addInfo(Entities.Component.name, name, Differentiators.First)
							.addInfo(Entities.Component.version, version, Differentiators.First)
							.addInfo(Entities.Component.name, requiredComponent, Differentiators.Second)
							.addInfo(Entities.Component.version, requiredComponentVersion, Differentiators.Second));

					eachCb();
				}, cb);
			}
		], callback);
	}, mainCallback);
}

function validateThirdPartyLibsCompatibilities(componentsVersions, callback) {
	validateThirdPartyLibCompatibilities(
		consts.thirdPartyLibs.LIBRDKAFKA,
		componentsVersions.librdkafka,
		consts.components.UPGRADE_AGENT,
		componentsVersions.upgradeAgent,
		callback
	);
}

function validateThirdPartyLibCompatibilities(libName, libVersionsFound, nvmeshPackageName, nvmeshPackageRawVersion, callback) {
	if (!nvmeshPackageRawVersion)
		return callback(new SystemMessage(systemMessages.MISSING_NVMESH_PACKAGE_VERSION_ON_A_COMPONENT)
			.addInfo(Entities.Component.name, nvmeshPackageName));

	if (libVersionsFound.includes(null))
		return callback(new SystemMessage(systemMessages.MISSING_LIB_FOUND_ON_A_COMPONENT)
			.addInfo(Entities.Component.name, nvmeshPackageName)
			.addInfo(Entities.Component.name, libName));

	const interopDB = app.get('interopDB');
	const nvmeshPackageVersion = utils.getVRPartsObj(nvmeshPackageRawVersion).version;

	interopDB.getCompatibilities(nvmeshPackageName, consts.componentTypes.THIRD_PARTY, nvmeshPackageVersion, compatibilities => {
		if (compatibilities.error)
			return callback(new SystemMessage(systemMessages.INTEROPDB_GET_COMPATIBILITIES_FAILED)
				.addInfo(Entities.Component.name, nvmeshPackageName)
				.addInfo(Entities.Component.version, nvmeshPackageVersion)
				.addInfo(Entities.Error, new InteropDBError(compatibilities.error)));

		const expectedLibVersions = compatibilities.data[libName];
		if (!expectedLibVersions)
			return callback(new SystemMessage(systemMessages.NO_COMPATIBILITIES_FOUND_FOR_LIB)
				.addInfo(Entities.Component.name, nvmeshPackageName)
				.addInfo(Entities.Component.version, nvmeshPackageVersion)
				.addInfo(Entities.Component.name, libName));

		if (libVersionsFound.some(libVersion => !expectedLibVersions.includes(libVersion)))
			return callback(new SystemMessage(systemMessages.LIB_NOT_COMPATIBLE_WITH_NVMESH_PACKAGE)
				.addInfo(Entities.Component.name, nvmeshPackageName)
				.addInfo(Entities.Component.name, libName)
				.addInfo(Entities.Component.version, libVersionsFound, Differentiators.Found)
				.addInfo(Entities.Component.version, expectedLibVersions, Differentiators.Expected));

		callback();
	});
}

scope.fetchUpgradeByID = function(upgradeID, cb) {
	utils.fetchEntityByID('upgrade', upgradeID, false, {}, systemMessages.UPGRADE_NOT_FOUND, cb);
};

module.exports = scope;

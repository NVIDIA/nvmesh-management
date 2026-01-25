/*
 * SPDX-FileCopyrightText: Copyright (c) 2026 NVIDIA CORPORATION & AFFILIATES. All rights reserved.
 * SPDX-License-Identifier: Apache-2.0
 */

/* global app,log,describe,before,it */
const assert = require('assert');

const consts = require('../consts.js');
const dbManager = require('./testUtils/dbManager.js');
const { setup } = require('./testUtils/setup.js');
const { kafkaMessageTypes } = require('../consts.js');
const { Client } = require('./models/client.js');
const { sendMessageToManagement } = require('./kafkaMessages/sendMessage.js');
const { ClientKeepAliveBuilder } = require('./kafkaMessages/fromClient/clientMessageBuilders.js');
const { AgentKeepAliveBuilder } = require('./kafkaMessages/fromAgent/agentKeepAlive.js');

const { applyClusterDefaultConfigurationToNodes, save } = require('../modules/configurationProfiles.js');
const configProfilesModule = require('../modules/configurationProfiles.js');
const { ConfigProfileUpdatedBuilder } = require('./kafkaMessages/fromAgent/configProfileUpdated.js');
const { UpdateConfigProfileUserOverrideBuilder } = require('./kafkaMessages/fromAgent/updateConfigProfileUserOverride.js');
const { generateTarget } = require('./testUtils/entityGenerators.js');
const { assertIsCausedBy } = require('./testUtils/errorUtils.js');
const systemMessages = require('../systemMessages.js');
const { Entities } = require('../modules/error.js');
const { sendAgentKeepaliveAndValidateTokenReceived,
	sendClientKeepaliveAndValidateTokenReceived } = require('./testUtils/clientUtils.js');


var clientCollection;
var nodeConfigurationCollection;

describe('Configuration Profiles', () => {

	before(() => {
		return dbManager.connect().then(() => {
			clientCollection = app.get('db').collection('client');
			nodeConfigurationCollection = app.get('db').collection('nodeConfiguration');
		});
	});

	const adminUser = { email: 'admin@nvidia.com' };
	function promiseSaveProfile(profile) {
		return new Promise(resolve => {
			configProfilesModule.save([profile], adminUser, logs => {
				resolve(logs[0].createApiResponse(Entities.ConfigurationProfile.ID, Entities.ConfigurationProfile.UUID));
			});
		});
	}

	function promiseUpdateProfile(profile) {
		return new Promise(resolve => {
			configProfilesModule.updateConfigurationProfiles([profile], adminUser, logs => {
				resolve(logs[0].createApiResponse(Entities.ConfigurationProfile.ID, Entities.ConfigurationProfile.UUID));
			});
		});
	}

	function promiseApplyProfile(profile, nodeIDs) {
		return new Promise(resolve => configProfilesModule.apply(profile, nodeIDs, adminUser, logs =>
			resolve(logs[0].createApiResponse(Entities.ConfigurationProfile.ID, Entities.ConfigurationProfile.UUID))));
	}

	function promiseDeleteProfiles(profiles) {
		return new Promise(resolve => configProfilesModule.delete(profiles, logs =>
			resolve(logs.map(l => l.createApiResponse(Entities.ConfigurationProfile.ID, Entities.ConfigurationProfile.UUID)))));
	}

	function promiseGetNodeConfigsPerProfile(profileName, profileUUID) {
		return new Promise(resolve => {
			configProfilesModule.getNodeConfigsPerProfile(profileName, profileUUID, (err, nodes) => {
				resolve({ err, nodes });
			});
		});
	}

	describe('Default configProfile should be applied if keepalive received from agent without configProfile on disk', () => {
		let client = new Client('Client1');
		client.configProfile = {};

		async function waitAndHandleAgentUpdateConfigProfileMsg() {
			let msg = await client.waitForAgentMessageType(kafkaMessageTypes.ManagementToAgent.updateConfigProfile);
			assert(msg, 'expected new updateConfigProfile message to be sent');

			client.mgmtAgentToken = msg.payload.token;
			client.agentMessageSequence = msg.payload.messageSequence;
			return msg;
		}

		before(() => setup.newSetup().then(() => log.debug('finished setup')));

		it('keep-alive with token -1 when client doesn\'t exists', () => {
			return sendAgentKeepaliveAndValidateTokenReceived(client, clientCollection);
		});

		it('keep-alive without configProfile should update managementAgent status', () => {
			const keepAliveMsg = AgentKeepAliveBuilder.fromClient(client).build();

			return sendMessageToManagement(keepAliveMsg)
				.then(() => clientCollection.findOne({ _id: client.id }))
				.then(dbClient => {
					assert(dbClient);
					assert.strictEqual(client.mgmtAgentToken, dbClient.managementAgentToken);
					assert.strictEqual(consts.managementAgentStatuses.UP, dbClient.managementAgentStatus);
					assert.strictEqual(client.agentMessageSequence, dbClient.agentKafkaMessageSequence.keepalive);
				});
		});

		it('validate default configuration profile is sent to agent', () => {
			return waitAndHandleAgentUpdateConfigProfileMsg()
				.then(msg => {
					assert.strictEqual(msg.payload.name, 'Cluster Default');

					client.configProfile = {
						name: msg.payload.name,
						id: msg.payload.parameters.CONFIG_PROFILE_ID,
						version: msg.payload.parameters.CONFIG_PROFILE_VERSION
					};
				});
		});

		it('should send configProfileUpdated to management', () => {
			const configProfileUpdatedMsg = ConfigProfileUpdatedBuilder.fromClient(client).build();

			return sendMessageToManagement(configProfileUpdatedMsg)
				.then(() => nodeConfigurationCollection.findOne({ _id: client.id }))
				.then(dbNodeConfig => {
					assert.strictEqual(client.configProfile.id, dbNodeConfig.desiredProfile.id);
					assert.strictEqual(consts.configurationProfile.status.RESTART_REQUIRED, dbNodeConfig.status);
				});
		});

		it('should set nodeConfig status as OK after client startup flow', () => {
			return sendClientKeepaliveAndValidateTokenReceived(client, clientCollection)
				.then(() => {
					const keepAliveMsg = ClientKeepAliveBuilder.fromClient(client).build();

					return sendMessageToManagement(keepAliveMsg);
				})
				.then(() => clientCollection.findOne({ _id: client.id }))
				.then(dbClient => assert.strictEqual(dbClient.clientToken, client.clientToken))
				.then(() => {
					return client.sendClientKeepAlive();
				})
				.then(async() => {
					let shouldContinue = true;
					let retries = 20;

					while (shouldContinue && retries--) {
						await new Promise(r => setTimeout(r, 100));
						let c = await nodeConfigurationCollection.findOne({ _id: client.id });
						shouldContinue = c.status !== consts.configurationProfile.status.OK;
					}

					assert(retries);
				})
				.then(() => nodeConfigurationCollection.findOne({ _id: client.id }))
				.then(dbNodeConfig => {
					assert.strictEqual(client.configProfile.id, dbNodeConfig.desiredProfile.id);
					assert.strictEqual(consts.configurationProfile.status.OK, dbNodeConfig.status);
				});
		});
	});

	describe('Update Configuration Profile', () => {
		let nodeID = 'node1';
		let client = new Client(nodeID);
		let target = generateTarget(nodeID, '1');

		before(() => {
			return setup.newSetup()
				.then(() => client.save())
				.then(() => log.debug('finished setup'));
		});


		it('agent should get UpdateProfileConfig', () => {
			return new Promise((resolve, reject) => {
				applyClusterDefaultConfigurationToNodes([client.id], err => {
					if (err) return reject(err);
					resolve();
				});
			})
				.then(async function() {
					let msg = await (await client.getAgentQueue()).readMessageOrWait();
					assert.strictEqual(msg.type, consts.kafkaMessageTypes.ManagementToAgent.updateConfigProfile);

					assert(msg.payload);
					assert.strictEqual(msg.payload.name, 'Cluster Default');
					assert(msg.payload.parameters);

					client.configProfile = {
						name: msg.payload.name,
						id: msg.payload.parameters.CONFIG_PROFILE_ID,
						version: msg.payload.parameters.CONFIG_PROFILE_VERSION
					};
				});
		});

		it('nodeConfiguration in db should have status APPLYING', () => {
			return Promise.resolve()
				.then(() => nodeConfigurationCollection.findOne({ _id: client.id }))
				.then(dbNodeConfig => {
					assert.strictEqual(consts.configurationProfile.defaults.CLUSTER_DEFAULT, dbNodeConfig.desiredProfile.name);
					assert.strictEqual(consts.configurationProfile.status.APPLYING, dbNodeConfig.status);
				});
		});

		it('agent sends configProfileUpdated message', () => {
			let configProfileUpdatedMsg = ConfigProfileUpdatedBuilder.fromClient(client).build();
			return sendMessageToManagement(configProfileUpdatedMsg)
				.then(() => nodeConfigurationCollection.findOne({ _id: client.id }))
				.then(dbNodeConfig => {
					assert.strictEqual(client.configProfile.id, dbNodeConfig.desiredProfile.id);
					assert.strictEqual(consts.configurationProfile.status.RESTART_REQUIRED, dbNodeConfig.status);
				});
		});

		it('agent sends updateConfigProfileUserOverride message', async() => {
			let userOverrideMessage = UpdateConfigProfileUserOverrideBuilder.fromClient(client)
				.setUserOverride(true)
				.build();
			await sendMessageToManagement(userOverrideMessage);
			let dbNodeConfig = await nodeConfigurationCollection.findOne({ _id: client.id });
			assert(dbNodeConfig);
			assert.strictEqual(client.configProfile.id, dbNodeConfig.desiredProfile.id);
			assert.strictEqual(client.configProfile.userOverride, userOverrideMessage.payload.configProfileInfo.userOverride);

			return Promise.resolve();
		});

		it('target sends report - nodeConf.status should still be RESTART_REQURIED', async() => {
			// update target with the profile info from client
			let configProfileUpdatedMsg = ConfigProfileUpdatedBuilder.fromClient(client).build();
			let profileInfo = configProfileUpdatedMsg.payload.configProfileInfo;
			target.configProfile.id = profileInfo.id;
			target.configProfile.name = profileInfo.name;
			target.configProfile.version = profileInfo.version;

			// target sends report
			await target.save();

			let shouldContinue = true;
			let retries = 20;

			while (shouldContinue && retries--) {
				await new Promise(r => setTimeout(r, 100));
				let c = await nodeConfigurationCollection.findOne({ _id: target._id });
				shouldContinue = c.status !== consts.configurationProfile.status.RESTART_REQUIRED;
			}

			assert(retries);

			return Promise.resolve();
		});

		it.skip('client sends report - nodeConf.status should be OK', async() => {
			// send client keepalive
			let err = await client.sendClientKeepAlive();
			assert(!err);

			// make sure nodeConfig doc has status ok and no "desiredProfile"
			let dbNodeConfig = await nodeConfigurationCollection.findOne({ _id: client.id });
			assert(dbNodeConfig);
			assert(!dbNodeConfig.desiredProfile);
			assert.strictEqual(dbNodeConfig.status, consts.configurationProfile.status.OK);
		});
	});

	describe('Configuration Profile - KeepAlive flows', () => {
		let client = new Client('Client1');

		before(() => {
			return setup.newSetup()
				.then(() => client.save())
				.then(() => log.debug('finished setup'));
		});


		it('agent should get UpdateProfileConfig', () => {
			return new Promise((resolve, reject) => {
				applyClusterDefaultConfigurationToNodes([client.id], err => {
					if (err) return reject(err);
					resolve();
				});
			})
				.then(async function() {
					let msg = await (await client.getAgentQueue()).readMessageOrWait();
					assert.strictEqual(msg.type, consts.kafkaMessageTypes.ManagementToAgent.updateConfigProfile);

					assert(msg.payload);
					assert.strictEqual(msg.payload.name, 'Cluster Default');
					assert(msg.payload.parameters);

					// but we don't update the client (as if message lost)

					client.configProfile = {
						name: msg.payload.name,
						id: msg.payload.parameters.CONFIG_PROFILE_ID,
						version: msg.payload.parameters.CONFIG_PROFILE_VERSION
					};
				});
		});

		it('nodeConfiguration in db should have status APPLYING', () => {
			return Promise.resolve()
				.then(() => nodeConfigurationCollection.findOne({ _id: client.id }))
				.then(dbNodeConfig => {
					assert.strictEqual(consts.configurationProfile.defaults.CLUSTER_DEFAULT, dbNodeConfig.desiredProfile.name);
					assert.strictEqual(consts.configurationProfile.status.APPLYING, dbNodeConfig.status);
				});
		});

		it('agent sends keepAlive with old profile', () => {
			let keepAliveMsg = AgentKeepAliveBuilder.fromClient(client).build();
			keepAliveMsg.payload.configProfileInfo.id = 'some_other_profile';
			return sendMessageToManagement(keepAliveMsg)
				.then(async function() {
					let msg = await (await client.getAgentQueue()).readMessageOrWait();
					assert.strictEqual(msg.type, consts.kafkaMessageTypes.ManagementToAgent.updateConfigProfile);

					assert(msg.payload);
					assert.strictEqual(msg.payload.name, 'Cluster Default');
					assert(msg.payload.parameters);

					// update the client for the next keep alive yto have the updated profile
					client.configProfile = {
						name: msg.payload.name,
						id: msg.payload.parameters.CONFIG_PROFILE_ID,
						version: msg.payload.parameters.CONFIG_PROFILE_VERSION
					};
				});
		});

		it('agent sends another keepAlive with new profile - should set as applied', () => {
			let keepAliveMsg = AgentKeepAliveBuilder.fromClient(client).build();
			return sendMessageToManagement(keepAliveMsg)
				.then(() => new Promise(resolve => setTimeout(resolve, 100)))
				.then(() => nodeConfigurationCollection.findOne({ _id: client.id }))
				.then(dbNodeConfig => {
					assert.strictEqual(client.configProfile.id, dbNodeConfig.desiredProfile.id);
					assert.strictEqual(consts.configurationProfile.status.RESTART_REQUIRED, dbNodeConfig.status);
				});
		});

		it('agent keepalive with empty configProfileInfo field', () => {
			let keepAliveMsg = AgentKeepAliveBuilder.fromClient(client).build();
			keepAliveMsg.configProfileInfo = null;
			return sendMessageToManagement(keepAliveMsg)
				.then(err => {
					assert(!err);
				});
		});

		it('agent keepalive with configProfileInfo with nulls', () => {
			let keepAliveMsg = AgentKeepAliveBuilder.fromClient(client).build();
			keepAliveMsg.payload.configProfileInfo.id = null;
			keepAliveMsg.payload.configProfileInfo.version = null;
			keepAliveMsg.payload.configProfileInfo.name = null;
			return sendMessageToManagement(keepAliveMsg)
				.then(err => {
					assert(!err);
				});
		});
	});

	describe('Node Config Status "restartRequired" for Agent startup', () => {
		// 1. agent startup
		// 2. apply new config profile
		// 3. validate agent sends back applied
		// 4. validate status restartRequired
		// 5. timeout
		// 6. agent startup without cache
		// 7. validate got config profile configuration

		let client = new Client('Client1');
		const newConfigProfileName = 'NVMesh Debug';

		before(() => {
			return setup.newSetup()
				.then(() => client.save())
				.then(() => log.debug('finished setup'));
		});

		it('set new configuration profile with status restartRequired', async() => {
			const nvmeshDebugProfile = await app.get('db').collection('configurationProfile').findOne({ _id: newConfigProfileName });
			let nodeIDs = [client.id];
			const applyRes = await promiseApplyProfile(nvmeshDebugProfile, nodeIDs);
			let nodeConfig = await app.get('db').collection('nodeConfiguration').findOne({ _id: client.id });
			assert(applyRes.success, JSON.stringify(applyRes.error));

			assert.strictEqual(nodeConfig.status, consts.configurationProfile.status.APPLYING);

			const configProfileToReport = { version: nvmeshDebugProfile.version, id: nvmeshDebugProfile.uuid, name: nvmeshDebugProfile.name };
			client.configProfile = configProfileToReport;
			client.configProfile = configProfileToReport;
			await sendMessageToManagement(AgentKeepAliveBuilder.fromClient(client).build());

			const maxRetries = 20;
			let attempts = 0;
			let success;

			while (attempts < maxRetries && !success) {
				attempts++;
				nodeConfig = await app.get('db').collection('nodeConfiguration').findOne({ _id: client.id });
				success = nodeConfig.status !== consts.configurationProfile.status.RESTART_REQUIRED;
				await new Promise(r => setTimeout(r, 100));
			}

			assert(success);
		});

		it('client timeout', async() => await client.timedOutClient());

		it('agent startup without cache', async() => {
			await client.resetAgentQueue();

			const configProfileBackup = client.configProfile;
			client.configProfile = {};

			await sendMessageToManagement(AgentKeepAliveBuilder.fromClient(client).build());
			client.clientToken++;


			const msg = await client.waitForAgentMessageType(consts.kafkaMessageTypes.ManagementToAgent.updateConfigProfile);
			assert.strictEqual(msg.payload.name, newConfigProfileName);

			client.configProfile = configProfileBackup;
			await client.sendClientKeepAlive();

			const maxRetries = 20;
			let attempts = 0;
			let success;

			while (attempts < maxRetries && !success) {
				attempts++;
				let nodeConfig = await app.get('db').collection('nodeConfiguration').findOne({ _id: client.id });
				success = nodeConfig.status === consts.configurationProfile.status.OK;
				await new Promise(r => setTimeout(r, 100));
			}

			assert(success);
		});


	});

	describe('Apply Configuration Profile', () => {
		let client1 = new Client('Client1');
		let client2 = new Client('Client2');

		let testProfile = {
			name: 'Test-Profile',
			config: {
				'AGENT_LOGGING_LEVEL': 'DEBUG'
			}
		};

		before(async() => {
			await setup.newSetup();
			await client1.save();
			await client2.save();
			let result = await promiseSaveProfile(testProfile);
			assert(result.success);
			testProfile.uuid = result.uuid;
			log.debug('finished setup');
		});

		it('should succeed', async() => {
			let res = await promiseApplyProfile(testProfile, [client1.id]);
			assert(res.success);
		});

		it('Profile not found', async() => {
			let notInDB = { name: 'profile-not-in-db', uuid: testProfile.uuid };
			let res = await promiseApplyProfile(notInDB, [client1.id]);
			assert(!res.success);
			assertIsCausedBy(res.error, systemMessages.CONFIG_PROFILE_NOT_FOUND);
		});

		it('get nodes list', async() => {
			let nodeIDs = [client1.id];
			let applyResult = await promiseApplyProfile(testProfile, nodeIDs);
			assert(applyResult.success);
			let { err, nodes } = await promiseGetNodeConfigsPerProfile(testProfile.name, testProfile.uuid);
			assert(!err);
			assert.strictEqual(nodes.length, 1);
			assert.strictEqual(nodes[0]._id, client1.id);
		});

		it('update profile - should update node to v2', async() => {
			testProfile.config.MCS_LOGGING_LEVEL = 'WARNING';

			let applyResult = await promiseApplyProfile(testProfile, [client1.id]);
			assert(applyResult.success);

			let updateResult = await promiseUpdateProfile(testProfile);
			assert(updateResult.success, JSON.stringify(updateResult.error));

			configProfilesModule.getNodeConfigsPerProfile(testProfile.name, testProfile.uuid, (err, nodes) => {
				assert(!err);
				assert.strictEqual(nodes.length, 1);
				assert.strictEqual(nodes[0]._id, client1.id);
				assert.strictEqual(nodes[0].desiredProfile.version, 2);
			});
		});
	});

	describe('parameters validations', () =>{
		function promiseSaveProfile(profile) {
			const adminUser = { email: 'admin@nvidia.com' };

			return new Promise(resolve => {
				save([profile], adminUser, logs => {
					resolve(logs[0].createApiResponse(Entities.ConfigurationProfile.ID, Entities.ConfigurationProfile.UUID));
				});
			});
		}

		before(() => setup.newSetup().then(() => log.debug('finished setup')));

		it('correct parameters should succeed', async() => {
			let configProfile = {
				config: {
					'IPV4_ONLY': true,
					'TCP_ENABLED': false,
					'DUMP_FTRACE_ON_OOPS': false,
					'MCS_LOGGING_LEVEL': 'INFO',
					'AGENT_LOGGING_LEVEL': 'INFO',
					'CONFIGURED_NICS': ['eth1'],
				}
			};

			let res = await promiseSaveProfile(configProfile);
			assert(res.success, `profile expected to be saved successfully. Error: ${res.error}`);
		});

		it('unknown parameter - should fail', async() => {
			let configProfile = {
				config: {
					'MY_SPECIAL_PARAM': ['a', 'b', 'c']
				}
			};

			let res = await promiseSaveProfile(configProfile);
			assert(!res.success, 'profile expected not to be saved successfully');
			assertIsCausedBy(res.error, systemMessages.CONFIG_PROFILE_VALIDATION_FAILED);

		});

		it('wrong value format with validationFunction- should fail', async() => {
			let configProfile = {
				config: {
					'KAFKA_SERVERS': 'a-string-instead-of-array'
				}
			};

			let res = await promiseSaveProfile(configProfile);
			assert(!res.success, 'profile expected to be saved successfully');
			assertIsCausedBy(res.error, systemMessages.CONFIG_PROFILE_VALIDATION_FAILED);
		});

		it('value wrong type - should fail', async() => {
			let configProfile = {
				config: {
					'TCP_ENABLED': 'Yes',
				}
			};

			let res = await promiseSaveProfile(configProfile);
			assert(!res.success, 'profile expected to be saved successfully');
			assertIsCausedBy(res.error, systemMessages.CONFIG_PROFILE_VALIDATION_FAILED);
		});

		it('value wrong expectedType - should fail', async() => {
			let configProfile = {
				config: {
					'CONFIGURED_NICS': 'Yes',
				}
			};

			let res = await promiseSaveProfile(configProfile);
			assert(!res.success, 'profile expected to be saved successfully');
			assertIsCausedBy(res.error, systemMessages.CONFIG_PROFILE_VALIDATION_FAILED);
		});

		it('value not an allowed option - should fail', async() => {
			let configProfile = {
				config: {
					'MCS_LOGGING_LEVEL': 'Not-Allow-Option'
				}
			};

			let res = await promiseSaveProfile(configProfile);
			assert(!res.success, 'profile expected to be saved successfully');
			assertIsCausedBy(res.error, systemMessages.CONFIG_PROFILE_VALIDATION_FAILED);
		});
	});

	describe('Delete Profile', () => {
		let client1 = new Client('Client1');
		let client2 = new Client('Client2');

		let testProfile = {
			name: 'Test-Profile',
			config: {
				'AGENT_LOGGING_LEVEL': 'DEBUG'
			}
		};

		before(async() => {
			await setup.newSetup();
			await client1.save();
			await client2.save();
			await client1.waitForAgentMessageType(kafkaMessageTypes.ManagementToAgent.updateConfigProfile);
			await client2.waitForAgentMessageType(kafkaMessageTypes.ManagementToAgent.updateConfigProfile);
			let result = await promiseSaveProfile(testProfile);
			assert(result.success);
			testProfile.uuid = result.uuid;
			let res = await promiseApplyProfile(testProfile, [client1.id, client2.id]);
			assert(res.success);
			log.debug('finished setup');
		});

		it('Nodes from deleted profile should revet to Cluster Default', async() => {
			// Verify nodes profile is testProfile
			let nodeConfigs = await nodeConfigurationCollection.find({ _id: { $in: [client1.id, client2.id] } }).toArray();
			nodeConfigs.forEach(c => {
				assert.strictEqual(c.desiredProfile.name, testProfile.name);
			});

			let res = await promiseDeleteProfiles([testProfile]);
			assert(res[0].success);

			nodeConfigs = await nodeConfigurationCollection.find({ _id: { $in: [client1.id, client2.id] } }).toArray();
			nodeConfigs.forEach(c => {
				assert.strictEqual(c.desiredProfile.name, consts.configurationProfile.defaults.CLUSTER_DEFAULT);
			});
		});
	});
});

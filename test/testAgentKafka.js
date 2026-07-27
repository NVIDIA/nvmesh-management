/* global app,log,describe,before,after,it */
const moment = require('moment');
const assert = require('assert');

const consts = require('../consts.js');
const dbManager = require('./testUtils/dbManager.js');
const { setup } = require('./testUtils/setup.js');
const { Client } = require('./models/client.js');
const { handleTimedOutComponent } = require('../modules/lastMessageLog.js');
const { sendMessageToManagement } = require('./kafkaMessages/sendMessage.js');
const { AgentKeepAliveBuilder } = require('./kafkaMessages/fromAgent/agentKeepAlive.js');

const clientModule = require('../modules/client.js');
const { originTypes } = require('../consts.js');
const { sendAgentKeepaliveAndValidateTokenReceived } = require('./testUtils/clientUtils.js');
const { LastMessageLog } = require('./models/lastMessageLog.js');
const { UpdateKeysBuilder } = require('./kafkaMessages/fromAgent/updateKeys.js');
const { Key } = require('./models/key.js');
const { delay } = require('./testUtils/common.js');
const { Entities } = require('../modules/error.js');

var clientCollection;

describe('Agent', function() {
	before(() => {
		return dbManager.connect().then(() => {
			clientCollection = app.get('db').collection('client');
		});
	});

	after(async() => {
		await delay(2000); // this is madatory as we have async flows still running and we dont want to close the connection until they are done
		await dbManager.closeConnection();
	});


	describe('Keep Alive', function() {
		let client = new Client('Client1');

		before(() => {
			return setup.newSetup()
				.then(() => log.debug('finished setup'));
		});

		it('keep-alive with token -1 when client doesn\'t exists', async() => {
			await sendAgentKeepaliveAndValidateTokenReceived(client, clientCollection);
		});

		it('agent should have a lastMessageLog', () => {
			var db = app.get('db');
			var lastMessageLogCollection = db.collection('lastMessageLog');

			var docID = {
				id: client.id,
				type: consts.originTypes.MANAGEMENT_AGENT
			};

			return lastMessageLogCollection.findOne({ _id: docID })
				.then((dbLastMsg) => {
					assert.strictEqual(dbLastMsg.status, consts.lastMessageLogStatuses.LIVE);
				});
		});

		it('agent timed-out - status should be DOWN', async() => {
			let token = 1;
			await new Promise(resolve => {
				// simulate a timed out component
				let tenMinsAgo = moment().subtract(10, 'minutes');
				let lastMessageLogDoc = new LastMessageLog(
					client.id,
					originTypes.MANAGEMENT_AGENT,
					consts.kafkaMessageTypes.AgentToManagement.keepalive,
					client.agentMessageSequence,
					token,
					tenMinsAgo);

				handleTimedOutComponent(lastMessageLogDoc, () => {
					resolve();
				});
			});

			// Make sure agent Status is DOWN
			let dbClient = await clientCollection.findOne({ _id: client.id });
			assert(dbClient);
			assert.strictEqual(consts.managementAgentStatuses.DOWN, dbClient.managementAgentStatus);
			assert.strictEqual(client.mgmtAgentToken + 1, dbClient.managementAgentToken);
			assert.strictEqual(1, dbClient.agentKafkaMessageSequence.keepalive);
		});

		it('keep-alive with after timeout', () => {
			return sendAgentKeepaliveAndValidateTokenReceived(client, clientCollection, 2);
		});

		it('keep-alive with token -1 after timeout', () => {
			client.setAgentToken(-1);
			return sendAgentKeepaliveAndValidateTokenReceived(client, clientCollection, 2);
		});

		it('keep-alive with correct token after timeout', () => {
			const keepAliveMsg = AgentKeepAliveBuilder.fromClient(client).build();

			return sendMessageToManagement(keepAliveMsg)
				.then(() => clientCollection.findOne({ _id: client.id }))
				.then(dbClient => {
					assert(dbClient);
					assert.strictEqual(client.mgmtAgentToken, dbClient.managementAgentToken);
					assert.strictEqual(consts.managementAgentStatuses.UP, dbClient.managementAgentStatus);
					assert.strictEqual(client.agentMessageSequence, dbClient.agentKafkaMessageSequence.keepalive);
					client.uuid = dbClient.uuid;
				});
		});

		it('should delete client', done => {
			client.timedOutClient()
				.then(() => {
					clientModule.deleteClients([{ _id: client.id, uuid: client.uuid }], messages => {
						const results = messages.map(l => l.createApiResponse(Entities.Client.ID));
						assert(results);
						assert(results.length);
						assert(results[0].success);

						clientCollection.findOne({ _id: client.id }, (err, res) => {
							assert(!err);
							assert(!res);

							done();
						});
					});
				});
		});

		it('keep-alive with token !== -1 when client doesn\'t exists', () => {
			return sendAgentKeepaliveAndValidateTokenReceived(client, clientCollection, 2)
				.then(() => {
					const keepAliveMsg = AgentKeepAliveBuilder.fromClient(client).build();
					return sendMessageToManagement(keepAliveMsg);
				})
				.then(() => clientCollection.findOne({ _id: client.id }))
				.then(dbClient => {
					assert(dbClient);
					assert.strictEqual(client.mgmtAgentToken, dbClient.managementAgentToken);
					assert.strictEqual(consts.managementAgentStatuses.UP, dbClient.managementAgentStatus);
					assert.strictEqual(client.agentMessageSequence, dbClient.agentKafkaMessageSequence.keepalive);
				});
		});
	});

	describe('Update Client Keys', () => {
		let client = new Client('Client1');
		let key1 = new Key('key1');
		let key2 = new Key('key2');
		before(() => {
			return setup.newSetup()
				.then(() => client.save())
				.then(() => log.debug('finished setup'));
		});

		it('Management should recieve updateKeys from agent', () => {
			let updateKeysMsg;

			return key1.save()
				.then(() => key2.save())
				.then(() => {
					// only add the keys after they are saved to the db
					// because only then they have the uuid field populated
					updateKeysMsg = UpdateKeysBuilder.fromClient(client)
						.addKey(key1)
						.addKey(key2)
						.build();
				})
				.then(() => sendMessageToManagement(updateKeysMsg))
				.then(() => clientCollection.findOne({ _id: client.id }))
				.then(dbClient => {
					assert(dbClient.keys);
					assert.strictEqual(dbClient.keys.length, 2);
				});
		});
	});
});
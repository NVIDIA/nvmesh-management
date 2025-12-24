/* global app, log */

const moment = require('moment');
const uuid = require('uuid');
const targetModule = require('../../modules/target.js');

const { Entity } = require('./entity.js');
const { sendMessageToManagement } = require('../kafkaMessages/sendMessage.js');
const { ReportTargetBuilder, TomaKeepAliveBuilder } = require('../kafkaMessages/fromTOMA/tomaMessageBuilders.js');
const { getIncrementalTargetUpdatesTopic } = require('../../modules/kafka.js');
const { getOrCreateQueue } = require('../testUtils/mockKafkaModule.js');
const systemMessages = require('../../systemMessages.js');
const { LastMessageLog } = require('./lastMessageLog.js');
const consts = require('../../consts.js');
const { handleTimedOutComponent } = require('../../modules/lastMessageLog.js');
const { delay } = require('../testUtils/common.js');

exports.Target = class Target extends Entity {
	constructor(nodeID, disks, nics) {
		super();
		this._id = nodeID;
		this.node_id = nodeID;
		this.uuid = uuid.v1();
		this.disks = disks || [];
		this.nics = nics || [];
		this.node_status = 1;
		this.cpu_load = 0.0;
		this.cpu_temp = '30.0';
		this.version = '3.1.0-1269';
		this.featureCompatibilityVersion = '0';
		this.tomaSoftwareVersion = '784';
		this.branch = 'master';
		this.commit = '0f0f0f0';
		this.configProfile = {
			id: 'cluster_default',
			version: '1',
			name: 'Cluster Default'
		};
		this.messageSequence = 1;
		this.dateModified = new Date();
		this.health = 'healthy';
		this.restartRequired = false;
		this.isPending = false;
		this.zone = '-1';
		this.reportID = 1;
		this.tomaToken = 1;
		this.desiredZone = null;
	}

	addDisk(disk) {
		this.disks.push(disk);
	}

	addNIC(nic) {
		this.nics.push(nic);
	}

	setZone(zone) {
		this.zone = zone;
	}

	setDesiredZone(zone) {
		this.desiredZone = zone;
	}

	async readMessageFromCommandsTopic() {
		let { topics } = await app.get('db').collection('server').findOne({ _id: this._id }, { topics: 1 });
		let msg = await getOrCreateQueue(topics[consts.topicSuffix.TOMA_COMMANDS]).readMessageOrWait();
		return msg;
	}

	async readMessageFromIncrementalUpdatesTopic() {
		let topic = await new Promise(resolve => getIncrementalTargetUpdatesTopic(this.zone, resolve));
		let msg = await getOrCreateQueue(topic).readMessageOrWait();
		return msg;
	}

	async save() {
		let self = this;
		const isZonesEnabled = app.get('globalSettings').enableZones;

		async function waitForNewTokenMessageFromMgmt() {
			let msg = await self.readMessageFromCommandsTopic();
			if (msg.type == 'updateTomaKeepaliveToken') {
				self.tomaToken = msg.token;
				if (msg.zone)
					self.setZone(msg.zone);
			}
		}

		async function waitForAddTargetMessageFromMgmt() {
			let msg = await self.readMessageFromIncrementalUpdatesTopic();
			if (msg.type == 'addTarget') {
				return msg;
			} else {
				console.log(`waiting for addTarget message but got ${msg.type} from incrementalUpdates`);
				return waitForAddTargetMessageFromMgmt();
			}
		}


		/* TOMA <> MGMT startup flow
		Before zone approval
			TOMA → MGMT Keepalive { zone: ‘-1’ }
			TOMA → MGMT Keepalive { zone: ‘-1’ }
			TOMA → MGMT Keepalive { zone: ‘-1’ }
			...
		After zone approval
			MGMT → TOMA UpdateTomaKeepaliveToken { nodeID: ‘nvme1.excelero.com’, token: 1, zone: ‘2’ }
			TOMA → MGMT Keepalive { zone: ‘2’}
			TOMA → MGMT reportTarget {zone: ‘2’, ...} 	(Due to zone change)
		*/

		if (!isZonesEnabled)
			this.zone = this.desiredZone;

		await self.sendKeepAlive();
		await self.setUUID();

		if (!isZonesEnabled)
			await waitForNewTokenMessageFromMgmt();

		if (isZonesEnabled && self.desiredZone != null) {
			await self._addToZone();
			await waitForNewTokenMessageFromMgmt();
			await self.sendKeepAlive();
			await self.sendReport();
			await waitForAddTargetMessageFromMgmt();
		} else {
			await self.sendKeepAlive();

			if (!isZonesEnabled) {
				await self.sendReport();
				await waitForAddTargetMessageFromMgmt();
			}
		}

		return;
	}

	sendReport() {
		let msg = ReportTargetBuilder.fromTarget(this).build();
		log.debug(`sending report node_id=${msg.hostname} reportID=${msg.reportID} token=${msg.tomaToken} seq=${msg.messageSequence}`);
		return sendMessageToManagement(msg);
	}

	async sendKeepAlive() {
		log.debug(`TOMA sending keepalive node_id=${this.hostname} token=${this.tomaToken}`);
		let msg = TomaKeepAliveBuilder.fromTarget(this).build();
		return sendMessageToManagement(msg);
	}

	async setUUID() {
		let retries = 0;
		const MAX_RETRIES = 20;
		const RETRY_DELAY_MS = 50;

		while (retries <= MAX_RETRIES) {
			let result = await app.get('db').collection('server').findOne({ _id: this._id }, { uuid: 1 });
			if (result && result.uuid) {
				this.uuid = result.uuid;
				return;
			}

			retries++;
			if (retries >= MAX_RETRIES) {
				throw new Error(`Failed to set UUID for target ${this._id} after ${MAX_RETRIES} retries`);
			}
			await delay(RETRY_DELAY_MS);
		}
	}

	_addToZone() {
		let zone = this.desiredZone;
		let nodeID = this.node_id;

		if (!app.get('globalSettings').enableZones)
			return Promise.resolve();

		// if zones are enable we simulate here a user setting zone on this target.
		return new Promise((resolve, reject) => {
			if (!zone)
				return resolve();
			targetModule.setZone([{ _id: nodeID, uuid: this.uuid }], zone, (logs) => {
				if (logs[0].systemMessage.id !== systemMessages.SET_ZONE_SUCCESS.id)
					return reject(logs[0]);

				resolve(logs[0]);
			});
		});
	}

	timedOut() {
		return new Promise(resolve => {
			const tenMinsAgo = moment().subtract(10, 'minutes');
			const lastMessageLogDoc = new LastMessageLog(this._id, consts.originTypes.TOMA,
				consts.kafkaMessageTypes.TOMAToManagament.keepalive, this.messageSequence, this.tomaToken, tenMinsAgo);

			handleTimedOutComponent(lastMessageLogDoc, resolve);
		});
	}

	delete() {
		return new Promise(resolve => targetModule.deleteTargets([{ _id: this._id, uuid: this.uuid }], false, resolve));
	}

	evict() {
		return new Promise(resolve => targetModule.deleteTargets([{ _id: this._id, uuid: this.uuid }], true, resolve));
	}
};

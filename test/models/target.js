/*
 * SPDX-FileCopyrightText: Copyright (c) 2026 NVIDIA CORPORATION & AFFILIATES. All rights reserved.
 * SPDX-License-Identifier: Apache-2.0
 */

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
		this.featureCompatibilityVersion = '1';
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
	}

	addDisk(disk) {
		this.disks.push(disk);
	}

	async addDiskAndReport(disk) {
		const server = await app.get('db').collection('server').findOne({ _id: disk.nodeID }, { 'disks.reappearingCounter': 1 });
		if (server) {
			const reappearingCounter = server.disks.find(d => d.diskID === disk.diskID)?.reappearingCounter;
			if (reappearingCounter && reappearingCounter !== disk.reappearingCounter)
				disk.reappearingCounter = reappearingCounter;
		}

		this.disks.push(disk);
		this.messageSequence++;
		this.reportID++;
		await this.sendReport();
	}

	async removeDiskAndReport(diskID) {
		const index = this.disks.findIndex(d => d.diskID === diskID);
		if (index === -1)
			throw new Error(`Disk ${diskID} not found on target ${this.node_id}`);

		const [disk] = this.disks.splice(index, 1);
		this.messageSequence++;
		this.reportID++;
		await this.sendReport();
		return disk;
	}

	addNIC(nic) {
		this.nics.push(nic);
	}

	async setZone(zone) {
		if (!app.get('globalSettings').enableZones)
			throw new Error('setZone must not be called when zones are disabled');

		await this._addToZone(zone);
		await this._completeZoneAssignment();
		return this;
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

		await self.sendKeepAlive();
		await self.setUUID();

		if (isZonesEnabled)
			return self;

		// zones disabled — management auto-assigns zone '1'
		self.zone = '1';
		await self._completeZoneAssignment();
		return self;
	}

	async _waitForNewTokenMessageFromMgmt() {
		let msg = await this.readMessageFromCommandsTopic();
		if (msg.type == 'updateTomaKeepaliveToken') {
			this.tomaToken = msg.token;
			if (msg.zone)
				this.zone = msg.zone;
		}
	}

	async _waitForAddTargetMessageFromMgmt() {
		let msg = await this.readMessageFromIncrementalUpdatesTopic();
		if (msg.type == 'addTarget') {
			return msg;
		} else {
			console.log(`waiting for addTarget message but got ${msg.type} from incrementalUpdates`);
			return this._waitForAddTargetMessageFromMgmt();
		}
	}

	async _completeZoneAssignment() {
		await this._waitForNewTokenMessageFromMgmt();
		await this.sendKeepAlive();
		await this.sendReport();
		await this._waitForAddTargetMessageFromMgmt();
	}

	async sendReport() {
		let msg = ReportTargetBuilder.fromTarget(this).build();
		log.debug(`sending report node_id=${msg.hostname} reportID=${msg.reportID} token=${msg.tomaToken} seq=${msg.messageSequence}`);
		const err = await sendMessageToManagement(msg);
		if (err)
			throw new Error(`Failed to send report to management: ${err}`);
	}

	async sendKeepAlive() {
		log.debug(`TOMA sending keepalive node_id=${this.hostname} token=${this.tomaToken}`);
		let msg = TomaKeepAliveBuilder.fromTarget(this).build();
		const err = await sendMessageToManagement(msg);
		if (err)
			throw new Error(`Failed to send keepalive to management: ${err}`);
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
			await delay(RETRY_DELAY_MS);
		}

		throw new Error(`Failed to set UUID for target ${this._id} after ${MAX_RETRIES} retries`);
	}

	_addToZone(zone) {
		let nodeID = this.node_id;

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

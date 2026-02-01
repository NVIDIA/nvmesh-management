/*
 * SPDX-FileCopyrightText: Copyright (c) 2026 NVIDIA CORPORATION & AFFILIATES. All rights reserved.
 * SPDX-License-Identifier: Apache-2.0
 */

/* global log */

const { Target } = require('../models/target');
const { Client } = require('../models/client');
const { Disk } = require('../models/disk');
const { TargetNIC } = require('../models/targetNic');
const { VolumeRAID10, VolumeConcatenated, VolumeRAID0, VolumeRAID1, VolumeEC } = require('../models/volume.js');

const { setEnableZones } = require('./settingsUtils.js');


exports.generateTargetsByIds = function(nodeIDs, zone, numOfDisks, numOfNics) {
	log.debug(`generateTargetsByIds: generating ${nodeIDs.length} targets`);

	let targets = [];

	nodeIDs.forEach(nodeID => {
		let t = exports.generateTarget(nodeID, zone, numOfDisks, numOfNics);
		targets.push(t);
	});

	return targets;
};

exports.generateTargets = function(count, zone, numOfDisks, numOfNics) {
	log.debug(`generating ${count} targets`);
	let nodeIDs = [];

	for (var i = 0; i < count; i++) {
		nodeIDs.push('test-server-' + nodeIDs.length);
	}

	return exports.generateTargetsByIds(nodeIDs, zone, numOfDisks, numOfNics);
};

exports.generateClientsByIds = function(clientIDs) {
	log.debug(`generateClientsByIds: generating ${clientIDs.length} clients`);

	let clients = [];

	clientIDs.forEach(clientID => {
		clients.push(new Client(clientID));
	});

	return clients;
};

exports.generateClients = function(count) {
	log.debug(`generating ${count} clients`);

	let clientIDs = [];

	for (let i = 0; i < count; i++) {
		clientIDs.push(`test-client-${i}`);
	}

	return exports.generateClientsByIds(clientIDs);
};

exports.generateTargetsPerZones = function(count, numOfZones, numOfDisks, numOfNics) {
	log.debug(`generating ${count} targets per ${numOfZones} zones`);

	let zones = [];
	let targets = [];

	if (numOfZones > 1)
		setEnableZones(true);

	for (let zoneIndex = 1; zoneIndex <= numOfZones; zoneIndex++) {
		let zone = [];

		for (let i = 0; i < count; i++) {
			zone.push(`test-server-${i}-zone-${zoneIndex}`);
		}

		zones.push(zone);
	}

	zones.forEach((zone, zoneIndex) => targets = targets.concat(exports.generateTargetsByIds(zone, zoneIndex + 1, numOfDisks, numOfNics)));

	return targets;
};

exports.generateTarget = function(nodeID, zone, numOfDisks, numOfNics) {
	numOfDisks = numOfDisks != undefined ? numOfDisks : 2;
	numOfNics = numOfNics != undefined ? numOfNics : 1;

	let target = new Target(nodeID);

	for (let i = 0; i < numOfDisks; i++) {
		let disk = exports.generateDisk(target.node_id, target.uuid, i);
		target.addDisk(disk);
	}

	for (let i = 0; i < numOfNics; i++) {
		let nic = exports.generateTargetNIC(nodeID, target.uuid, i);
		target.addNIC(nic);
	}

	if (zone)
		target.setDesiredZone(zone);

	return target;
};


exports.generateDisk = function(nodeID, nodeUUID, i) {
	// Serial will be in the following format:
	// assuming server node.id = 'target-1.acme.com' -> serial numbers will be TARGET-1.1, TARGET-1.2, ...
	let serial = nodeID.split('.')[0].toUpperCase() + '.' + (i + 1);
	return new Disk(serial, nodeID, nodeUUID);
};

exports.generateTargetNIC = function(nodeID, nodeUUID, nicIndex) {
	let nicID = '0xfe80000000000000' + nodeUUID.substring(0, 15) + nicIndex.toString();
	let nic = new TargetNIC(nicID, nodeID, nodeUUID);
	nic.deviceType = 'mlx5_' + nicIndex;
	return nic;
};

exports.generateAndSaveTargets = function(count, zone) {
	let targets = exports.generateTargets(count, zone);
	return Promise.all(targets.map(t => t.save()));
};

exports.generateAndSaveTargetsPerZone = function(count, numOfZones, numOfDisks, numOfNics) {
	let targets = exports.generateTargetsPerZones(count, numOfZones, numOfDisks, numOfNics);
	return Promise.all(targets.map(t => t.save()));
};

exports.generateAndSaveClients = function(count) {
	let clients = exports.generateClients(count);
	return Promise.all(clients.map(c => c.save()));
};

exports.generateAndSaveVolumes = function(jbod, r0, r1, r10, ec) {
	let volumes = [];
	let baseName = 'base';

	for (let i = 0; i < jbod; i++) {
		volumes.push(new VolumeConcatenated(`${baseName}-jbod-${i}`));
	}

	for (let i = 0; i < r0; i++) {
		volumes.push(new VolumeRAID0(`${baseName}-r0-${i}`));
	}

	for (let i = 0; i < r1; i++) {
		volumes.push(new VolumeRAID1(`${baseName}-r1-${i}`));
	}

	for (let i = 0; i < r10; i++) {
		volumes.push(new VolumeRAID10(`${baseName}-r10-${i}`));
	}

	for (let i = 0; i < ec; i++) {
		volumes.push(new VolumeEC(`${baseName}-ec-${i}`));
	}

	return Promise.all(volumes.map(v => v.save()));
};

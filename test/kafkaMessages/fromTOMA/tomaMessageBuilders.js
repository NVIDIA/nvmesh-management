/*
 * SPDX-FileCopyrightText: Copyright (c) 2026 NVIDIA CORPORATION & AFFILIATES. All rights reserved.
 * SPDX-License-Identifier: Apache-2.0
 */

/* global app */

const { diskSegmentStatuses, segmentVitality } = require('../../../consts');
const { KafkaMessageBuilder } = require('../kafkaMessageBuilder');
const { LeaderKeepAlive } = require('./LeaderKeepAlive');
const { ReportTarget } = require('./ReportTarget');
const { TomaKeepAlive } = require('./TomaKeepAlive');
const { updatePRaidReport: UpdatePRaidReport } = require('./updatePRaidReport');

exports.TomaMessageBuilder = class TomaMessageBuilder extends KafkaMessageBuilder {
	constructor(msg) {
		super(msg);

		// Default initial values
		this.msg.tomaToken = -1;
		this.msg.leaderToken = null;
		this.msg.messageSequence = 0;
	}

	setMessageSequence(value) {
		this.msg.messageSequence = value;
		return this;
	}

	incMessageSequence() {
		this.msg.messageSequence += 1;
		return this;
	}

	setToken(value) {
		this.msg.tomaToken = value;
		return this;
	}

	updateDataFromTarget(target) {
		this.msg.hostname = target.node_id;
		this.msg.tomaToken = target.tomaToken;
		this.msg.leaderToken = target.leaderToken;
		this.msg.messageSequence = target.messageSequence;
		this.msg.payload.version = target.version;
		this.msg.payload.tomaSoftwareVersion = target.tomaSoftwareVersion;
		this.msg.payload.featureCompatibilityVersion = target.featureCompatibilityVersion;
	}
};

exports.TomaKeepAliveBuilder = class TomaKeepAliveBuilder extends exports.TomaMessageBuilder {
	constructor(targetID) {
		let rawMsg = {
			hostname: targetID,
			keepaliveInterval: app.get('globalSettings').keepaliveIntervals.TOMA,
			payload: {
				zone: '-1'
			}
		};

		let msg = new TomaKeepAlive(rawMsg);
		super(msg);
	}

	setZone(newZone) {
		this.msg.payload.zone = newZone;
	}

	static fromTarget(target) {
		const builder = new TomaKeepAliveBuilder(target.node_id);
		builder.updateDataFromTarget(target);
		builder.setZone(target.zone);
		return builder;
	}
};

exports.LeaderKeepAliveBuilder = class LeaderKeepAliveBuilder extends exports.TomaMessageBuilder {
	constructor(targetID) {
		const rawMsg = {
			hostname: targetID,
			leaderToken: 1,
			keepaliveInterval: app.get('globalSettings').keepaliveIntervals.TOMA_LEADER,
			payload: {
				zone: '-1',
				raftTerm: 1,
			}
		};

		super(new LeaderKeepAlive(rawMsg));
	}

	setLeaderToken(value) {
		this.msg.leaderToken = value;
		return this;
	}

	setKeepaliveInterval(value) {
		this.msg.keepaliveInterval = value;
		return this;
	}

	setZone(newZone) {
		this.msg.payload.zone = newZone;
	}

	setRaftTerm(value) {
		this.msg.payload.raftTerm = value;
		return this;
	}

	setUpdatePRaidToken(value) {
		this.msg.updatePRaidToken = value;
		return this;
	}

	setRaftMembers(value) {
		this.msg.payload.raftMembers = value;
		return this;
	}

	setIsReconciled(value) {
		this.msg.payload.isReconciled = value;
		return this;
	}

	updateDataFromTarget(target) {
		super.updateDataFromTarget(target);
		if (target.raftTerm !== undefined)
			this.msg.payload.raftTerm = target.raftTerm;
		this.msg.updatePRaidToken = target.updatePRaidToken;
		this.msg.payload.raftMembers = target.raftMembers;
		this.msg.payload.isReconciled = target.isReconciled;
	}

	static fromTarget(target) {
		const builder = new LeaderKeepAliveBuilder(target.node_id);
		builder.updateDataFromTarget(target);
		builder.setLeaderToken(target.leaderToken);
		builder.setZone(target.zone);
		return builder;
	}
};

exports.ReportTargetBuilder = class ReportTargetBuilder extends exports.TomaMessageBuilder {
	constructor(targetID) {
		let rawMsg = {
			hostname: targetID,
			payload: {
				node: {
					zone: '-1',
					cpu_temp: 30,
					configProfile: { version: 0, id: 'DefaultID', name: 'DefaultName' },
					tomaToken: -1,
					node_status: 1,
					cpu_load: null,
					nics: [],
					disks: [],
					version: 'v1.0.0',
					branch: 'test',
					commit: 'abcde'
				}
			}
		};

		let msg = new ReportTarget(rawMsg);
		super(msg);
	}

	static fromTarget(target) {
		const builder = new ReportTargetBuilder(target.node_id);
		builder.updateDataFromTarget(target);
		let nodeWithRefObjs = {
			zone: target.zone,
			cpu_temp: target.cpu_temp,
			configProfile: target.configProfile,
			tomaToken: target.tomaToken,
			node_status: target.node_status,
			cpu_load: target.cpu_load,
			nics: target.nics,
			disks: target.disks,
			version: target.version,
			branch: target.branch,
			commit: target.commit
		};

		let node = JSON.parse(JSON.stringify(nodeWithRefObjs));
		builder.msg.payload = { node: node };
		return builder;
	}
};

exports.UpdatePRaidReportBuilder = class UpdatePRaidReportBuilder extends exports.TomaMessageBuilder {
	constructor() {
		let rawMsg = {
			payload: {
				pRaidsUpdate: []
			}
		};

		let msg = new UpdatePRaidReport(rawMsg);
		super(msg);
	}

	addPRaidReport(praidReport) {
		this.msg.payload.pRaidsUpdate.push(praidReport);
		return this;
	}

	setUpdatePRaidToken(value) {
		this.msg.updatePRaidToken = value;
		return this;
	}

	static fromTarget(target) {
		const builder = new UpdatePRaidReportBuilder(target.node_id);
		builder.updateDataFromTarget(target);
		return builder;
	}

	static fromVolume(volume, target) {
		const builder = UpdatePRaidReportBuilder.fromTarget(target);

		volume.chunks.forEach(chunk => {
			chunk.pRaids.forEach(pRaid => {
				let pRaidReport = exports.PRaidReport.fromPRaid(pRaid);
				builder.addPRaidReport(pRaidReport);
			});
		});

		return builder;
	}
};

exports.PRaidReport = class PRaidReport {
	constructor(uuid) {
		this.uuid = uuid;
		this.pRaidMajorVersion = 0;
		this.pRaidMinorVersion = 0;
		this.raftTerm = 0;
		this.isRaftLeader = 1;
		this.segments = [];
	}

	setVersion(major, minor) {
		this.pRaidMajorVersion = major;
		this.pRaidMinorVersion = minor;
		return this;
	}

	incPRaidMajorVersion() {
		this.pRaidMinorVersion += 1;
		return this;
	}

	setRaftTerm(raftTerm) {
		this.raftTerm = raftTerm;
		return this;
	}

	setIsRaftLeader(isRaftLeader) {
		this.isRaftLeader = isRaftLeader;
		return this;
	}

	addSegment(segmentReport) {
		this.segments.push(segmentReport);
		return this;
	}

	setUUID(uuid) {
		this.uuid = uuid;
		return this;
	}

	setSegmentStatuses(statuses) {
		this.segments.forEach((seg, i) => {
			seg.status = statuses[i];
			seg.vitality = seg.status != diskSegmentStatuses.DEAD ? segmentVitality.UP : segmentVitality.DOWN;
		});

		return this;
	}

	static fromPRaid(pRaid) {
		let report = new exports.PRaidReport(pRaid.uuid)
			.setVersion(pRaid.version.major, pRaid.version.minor)
			.setRaftTerm(pRaid.tomaLeaderRaftTerm);

		pRaid.diskSegments.forEach(seg => {
			let segmentReport = new exports.SegmentReport(seg.uuid)
				.setStatus(seg.status)
				.setVitality(seg.vitality);
			report.addSegment(segmentReport);
		});

		return report;
	}
};

exports.SegmentReport = class SegmentReport {
	constructor(uuid) {
		this.segmentID = uuid;
		this.status = '';
		this.vitality = 'up';
	}

	setStatus(status) {
		this.status = status;
		return this;
	}

	setVitality(vitality) {
		this.vitality = vitality;
		return this;
	}

	setUUID(uuid) {
		this.uuid = uuid;
		return this;
	}
};
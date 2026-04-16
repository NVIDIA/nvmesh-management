/*
 * SPDX-FileCopyrightText: Copyright (c) 2026 NVIDIA CORPORATION & AFFILIATES. All rights reserved.
 * SPDX-License-Identifier: Apache-2.0
 */

const { KafkaMessage } = require('./KafkaMessage');
const consts = require('../../consts');
exports.VolumeMessage = class VolumeMessage extends KafkaMessage {
	constructor(type, version, confObj) {
		super(type, version, confObj);
	}

	deserialize(confObj) {
		return confObj;
	}

	preparePayload(payload) {
		const preparedPayload = {};

		preparedPayload['_id'] = payload._id;
		preparedPayload['uuid'] = payload.uuid;
		preparedPayload['version'] = payload.version;
		preparedPayload['name'] = payload.name;
		preparedPayload['type'] = payload.type;
		preparedPayload['blockSize'] = payload.blockSize;
		preparedPayload['lockServer'] = payload.lockServer;
		preparedPayload['blocks'] = payload.blocks;
		preparedPayload['RAIDLevel'] = payload.RAIDLevel;
		preparedPayload['numberOfMirrors'] = payload.numberOfMirrors;
		preparedPayload['stripeSize'] = payload.stripeSize;
		preparedPayload['stripeWidth'] = payload.stripeWidth;
		preparedPayload['dataBlocks'] = payload.dataBlocks;
		preparedPayload['parityBlocks'] = payload.parityBlocks;
		preparedPayload['status'] = payload.status;
		preparedPayload['action'] = payload.action;
		preparedPayload['relativeRebuildPriority'] = payload.relativeRebuildPriority;
		preparedPayload['reservation'] = payload.reservation;
		preparedPayload['enableCrcCheck'] = payload.enableCrcCheck;
		preparedPayload['use_debug_di'] = payload.use_debug_di;

		preparedPayload['chunks'] = payload.chunks.map(c => ({
			uuid: c.uuid,
			vlbs: c.vlbs,
			vlbe: c.vlbe,
			pRaids: c.pRaids.map(p => ({
				uuid: p.uuid,
				activated: p.activated,
				stripeIndex: p.stripeIndex,
				zone: p.zone,
				diskSegments: p.diskSegments.map(d => ({
					uuid: d.uuid,
					lbs: d.lbs,
					lbe: d.lbe,
					type: d.type,
					pRaidIndex: d.pRaidIndex,
					pRaidTypeIndex: d.pRaidTypeIndex,
					status: d.status,
					diskUUID: d.status === consts.diskSegmentStatuses.MARKED_FOR_REBUILD_PENDING ? consts.REINSTATE_FAKE_DRIVE_UUID : d.diskUUID
				}))
			}))
		}));

		return preparedPayload;
	}

	toJSON() {
		const json = super.toJSON();

		return json;
	}
};

/*
 * SPDX-FileCopyrightText: Copyright (c) 2026 NVIDIA CORPORATION & AFFILIATES. All rights reserved.
 * SPDX-License-Identifier: Apache-2.0
 */

const { KafkaMessage } = require('./KafkaMessage');
const consts = require('../../consts');

function toExternalSegmentStatus(status) {
	if (status === consts.diskSegmentStatuses.MARKED_FOR_REBUILD_PENDING)
		return consts.diskSegmentStatuses.MARKED_FOR_REBUILD;

	return status;
}

exports.toExternalSegmentStatus = toExternalSegmentStatus;

function toExternalTomaSegment(segment) {
	const isReinstatePending = segment.status === consts.diskSegmentStatuses.MARKED_FOR_REBUILD_PENDING;

	return {
		status: isReinstatePending ? consts.diskSegmentStatuses.MARKED_FOR_REBUILD : segment.status,
		diskUUID: isReinstatePending ? consts.REINSTATE_FAKE_DRIVE_UUID : segment.diskUUID
	};
}

function prepareTomaDiskSegment(segment) {
	return {
		uuid: segment.uuid,
		lbs: segment.lbs,
		lbe: segment.lbe,
		type: segment.type,
		pRaidIndex: segment.pRaidIndex,
		pRaidTypeIndex: segment.pRaidTypeIndex,
		...toExternalTomaSegment(segment)
	};
}

function prepareTomaPRaid(pRaid) {
	return {
		uuid: pRaid.uuid,
		activated: pRaid.activated,
		stripeIndex: pRaid.stripeIndex,
		zone: pRaid.zone,
		diskSegments: pRaid.diskSegments.map(prepareTomaDiskSegment)
	};
}

function prepareTomaChunk(chunk) {
	return {
		uuid: chunk.uuid,
		vlbs: chunk.vlbs,
		vlbe: chunk.vlbe,
		pRaids: chunk.pRaids.map(prepareTomaPRaid)
	};
}

exports.VolumeMessage = class VolumeMessage extends KafkaMessage {
	constructor(type, version, confObj) {
		super(type, version, confObj);
	}

	deserialize(confObj) {
		return confObj;
	}

	preparePayload(payload) {
		return {
			_id: payload._id,
			uuid: payload.uuid,
			version: payload.version,
			name: payload.name,
			type: payload.type,
			blockSize: payload.blockSize,
			lockServer: payload.lockServer,
			blocks: payload.blocks,
			RAIDLevel: payload.RAIDLevel,
			numberOfMirrors: payload.numberOfMirrors,
			stripeSize: payload.stripeSize,
			stripeWidth: payload.stripeWidth,
			dataBlocks: payload.dataBlocks,
			parityBlocks: payload.parityBlocks,
			status: payload.status,
			action: payload.action,
			relativeRebuildPriority: payload.relativeRebuildPriority,
			reservation: payload.reservation,
			enableCrcCheck: payload.enableCrcCheck,
			use_debug_di: payload.use_debug_di,
			chunks: payload.chunks.map(prepareTomaChunk)
		};
	}
};

/*
 * SPDX-FileCopyrightText: Copyright (c) 2026 NVIDIA CORPORATION & AFFILIATES. All rights reserved.
 * SPDX-License-Identifier: Apache-2.0
 */

const { KafkaMessage } = require('./KafkaMessage');

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

		preparedPayload['volumeClass'] = payload.volumeClass || 'REGULAR';
		preparedPayload['isHidden'] = payload.isHidden || false;
		preparedPayload['cdvConfig'] = payload.cdvConfig || null;
		preparedPayload['tpvConfig'] = payload.tpvConfig || null;
		// mdvUUID is repurposed to carry the (data) CDV UUID for TPV volumes
		// so the kernel can look up the parent CDV (which is already attached)
		// when it creates the nvmeibc_tpv object.
		preparedPayload['mdvUUID'] = payload.mdvUUID || '';
		// Split-mode TPVs store their L1/L2 tree on a second CDV
		// (TPV_MetadataCDV.md). metaCdvUUID is a new, dedicated CM field —
		// kernels without split-mode awareness decode it as '' and run in
		// single-CDV mode. Empty string for single-CDV TPVs and all
		// non-TPV volumes.
		preparedPayload['metaCdvUUID'] = payload.metaCdvUUID || '';
		// Metadata-side geometry. The kernel needs the meta CDV's own
		// cdvExtentSizeMib (it may differ from the data CDV's) and the
		// TPV's meta-side extent size to compute L2-slot physical
		// offsets on the metadata CDV. Zero means "not split-mode" /
		// "fall back to data-side values".
		preparedPayload['metaCdvExtentSizeMib'] = payload.metaCdvExtentSizeMib || 0;
		preparedPayload['metaTpvExtentSizeKb'] = payload.metaTpvExtentSizeKb || 0;

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
					diskUUID: d.diskUUID
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

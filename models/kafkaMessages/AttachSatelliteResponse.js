/*
 * SPDX-FileCopyrightText: Copyright (c) 2026 NVIDIA CORPORATION & AFFILIATES. All rights reserved.
 * SPDX-License-Identifier: Apache-2.0
 */

const { KafkaMessage } = require('./KafkaMessage');
const { kafkaMessageTypes } = require('../../consts');

// Sent management → TOMA in response to AttachSatelliteRequest.
//
// On success (status === 'OK'), the TOMA can now open the satellite volume
// at `satelliteUUID` and use it as the backing store for the CDV allocator
// metadata.  The TOMA was attached EXCLUSIVE_READ_WRITE via the existing
// preempt path, so any prior allocator TOMA's writes will be fenced at the
// storage target by NVMesh's reservation-version check.
//
// On a non-OK status (STALE_GENERATION, CDV_NOT_FOUND, CDV_BEING_DELETED,
// INTERNAL_ERR), the TOMA either retries with a fresh requestId (transient)
// or tears down its in-memory allocator entry (terminal).
exports.AttachSatelliteResponse = class AttachSatelliteResponse extends KafkaMessage {
	constructor(payload) {
		super(kafkaMessageTypes.ManagementToTOMA.attachSatelliteResponse, 1);
		this.payloadFields = payload;
	}

	toJSON() {
		const json = super.toJSON();
		json['payload'] = this.payloadFields;
		return json;
	}
};

exports.AttachSatelliteResponseStatus = Object.freeze({
	OK: 'OK',
	STALE_GENERATION: 'STALE_GENERATION',
	CDV_NOT_FOUND: 'CDV_NOT_FOUND',
	CDV_BEING_DELETED: 'CDV_BEING_DELETED',
	INTERNAL_ERR: 'INTERNAL_ERR',
});

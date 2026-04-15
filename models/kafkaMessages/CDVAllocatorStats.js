/*
 * SPDX-FileCopyrightText: Copyright (c) 2026 NVIDIA CORPORATION & AFFILIATES. All rights reserved.
 * SPDX-License-Identifier: Apache-2.0
 */

const { MessageFromTOMA } = require('./MessageFromTOMA');
const { kafkaMessageTypes } = require('../../consts');

// Received TOMA → management after every CDV_ALLOC_EXTENT / CDV_FREE_EXTENT.
// Carries current allocation counters so the UI can display CDV space usage
// without polling.
exports.CDVAllocatorStats = class CDVAllocatorStats extends MessageFromTOMA {
	constructor(rawMsg) {
		super(kafkaMessageTypes.TOMAToManagement_TP.cdvAllocatorStats, 1, rawMsg);
	}

	// payload shape: { cdvUUID: string, allocatedExtents: number, totalDataExtents: number }
	get cdvUUID() { return this.payload.cdvUUID; }
	get allocatedExtents() { return this.payload.allocatedExtents; }
	get totalDataExtents() { return this.payload.totalDataExtents; }
};

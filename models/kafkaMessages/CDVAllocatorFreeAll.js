/*
 * SPDX-FileCopyrightText: Copyright (c) 2026 NVIDIA CORPORATION & AFFILIATES. All rights reserved.
 * SPDX-License-Identifier: Apache-2.0
 */

const { KafkaMessage } = require('./KafkaMessage');
const { kafkaMessageTypes } = require('../../consts');

// Sent management → TOMA when a TPV is deleted.
// Instructs the CDV allocator to reclaim all CDV_extents owned by the given TPV UUID
// and zero CDV_extent[0] (the flat-L1 tree) so the next TPV on this CDV starts clean.
exports.CDVAllocatorFreeAll = class CDVAllocatorFreeAll extends KafkaMessage {
	constructor(cdvUUID, tpvUUID, allocatorSizeGib, cdvExtentSizeMib) {
		super(kafkaMessageTypes.ManagementToTOMA.cdvAllocatorFreeAll, 1);
		this.cdvUUID = cdvUUID;
		this.tpvUUID = tpvUUID;
		this.allocatorSizeGib = allocatorSizeGib;
		this.cdvExtentSizeMib = cdvExtentSizeMib;
	}

	toJSON() {
		const json = super.toJSON();
		json['payload'] = {
			cdvUUID: this.cdvUUID,
			tpvUUID: this.tpvUUID,
			allocatorSizeGib: this.allocatorSizeGib,
			cdvExtentSizeMib: this.cdvExtentSizeMib,
		};
		return json;
	}
};

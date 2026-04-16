/*
 * SPDX-FileCopyrightText: Copyright (c) 2026 NVIDIA CORPORATION & AFFILIATES. All rights reserved.
 * SPDX-License-Identifier: Apache-2.0
 */

/* global app */

const uuid = require('uuid');
const consts = require('../../consts');
const { Entity } = require('./entity');

exports.Disk = class Disk extends Entity {
	constructor(serial, nodeID, nodeUUID) {
		super();
		this.diskID = serial;
		this.Serial_Number = serial;
		this.nodeID = nodeID;
		this.nodeUUID = nodeUUID;
		this.uuid = uuid.v1();
		this.Model = 'SAMSUNG MZWLL800HEHP-00003';
		this.isOutOfService = false;
		this.nZeroedBlks = 194971983;
		this.zeroWriteCounter = 193349197843.0;
		this.Completion_Queues = 128;
		this.status = consts.diskStatus.OK;
		this.blocks = 194972240;
		this.metadataCapabilities = 3;
		this.Available_Spare = '100_%';
		this.excludeReason = 'None';
		this.isExcluded = false;
		this.MSIX_Interrupts = 129;
		this.pci_address = '0000:84:00.0';
		this.Power_Cycles = '0xee';
		this.Percentage_Used = '5_%';
		this.Available_Spare_Threshold = '10_%';
		this.formatRequestCounter = 1;
		this.block_size = 4096;
		this.Submission_Queues = 128;
		this.Controller_Busy_Time = '0x85dc';
		this.activeFormatRequestCounter = 1;
		this.Vendor = 'Samsung';
		this.reappearingCounter = 4;
		this.metadata_size = 8;
		this.Numa_Node = 1;
		this.writeCounter = 193349197846.0;
		this.Critical_Warning = '0x0';
		this.Power_On_Hours = '0x416b';
		this.formatOptions = [{
			dataBS: 4096,
			metaBS: 0
		}, {
			dataBS: 4096,
			metaBS: 8
		}];
		this.Number_of_Error_Information_Log_Entries = '0xae';
		this.Media_Errors = '0x0';
		this.Unsafe_Shutdowns = '0x54';
		this.vendorID = 5197;
		this.availableBlocks = 193464576;
		this.usableBlocks = 193464576;
		this.largestSegmentAvailable = {
			lbs: 1507392,
			lbe: 194971967,
			blocks: 193464576
		};
		this.version = 1;
		this.reappearingOutOfSync = false;
		this.health = 'healthy';
		this.pci_root = null;
		this.isPendingFormat = false;
		this.GPT = new exports.GPT(this.uuid);
	}
};


exports.GPT = class GPT {
	constructor(diskUUID) {
		this.maxNGptEntries = 8192,
		this.diskGuid = diskUUID;
		this.isValid = 1;
		this.lastUsableLba = 194971967;
		this.firstUsableLba = 288;
		this.mgmtDbUuid = app.get('dbUUID');
		this.entries = [];
		//this.entries = this.mockEntries();
	}

	mockEntries() {
		return [
			{
				owner: 'nvmesh',
				end: 974911,
				mgmtDbUuid: '00000000-0000-0000-0000-000000000000',
				start: 288,
				partitionGuid: 'a32d7f50-879b-11ea-9555-2be36b7a62aa',
				partitionName: 'excelero_metadata',
				isZeroed: false,
				partitionType: 'excelero_metadata'
			},
			{
				owner: 'nvmesh',
				end: 1499199,
				mgmtDbUuid: '00000000-0000-0000-0000-000000000000',
				start: 974912,
				partitionGuid: '612825d2-d0d5-7e2e-fdd9-5c3fcc167239',
				partitionName: 'excelero_journal_data',
				isZeroed: false,
				partitionType: 'excelero_metadata'
			},
			{
				owner: 'nvmesh',
				end: 1507391,
				mgmtDbUuid: '00000000-0000-0000-0000-000000000000',
				start: 1499200,
				partitionGuid: '0b66397e-57b1-0186-f4ff-37223f669665',
				partitionName: 'excelero_serjio_db',
				isZeroed: false,
				partitionType: 'excelero_metadata'
			}
		];
	}
};

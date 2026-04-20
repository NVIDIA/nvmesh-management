/*
 * SPDX-FileCopyrightText: Copyright (c) 2026 NVIDIA CORPORATION & AFFILIATES. All rights reserved.
 * SPDX-License-Identifier: Apache-2.0
 */

const consts = require('../../consts.js');
const { pRaidOptionsPropertiesConditions } = require('../common/pRaidOptions.js');
const { encryptionPropertiesConditions } = require('../common/encryption.js');
const { classesScheme, limitByDisksScheme, limitByNodesScheme, limitationsDependencies } = require('../common/volumeLimitations.js');

const vpgScheme = { $ref: consts.MANAGEMENT_DEFINITIONS + '/existingVpgName.js' };
const RAIDLevelScheme = { enum: Object.values(consts.RAIDLevel) };
const isUsingVPG = { properties: { VPG: { minLength: 1 } }, required: ['VPG'] };

const limitationsProperties = {
	diskClasses: classesScheme,
	serverClasses: classesScheme,
	limitByDisks: limitByDisksScheme,
	limitByNodes: limitByNodesScheme,
	domain: { $ref: consts.MANAGEMENT_DEFINITIONS + '/domain.js#/properties/scope' },
};

const mdvSpecScheme = {
	type: 'object',
	unevaluatedProperties: false,
	properties: { VPG: vpgScheme },
	if: { not: isUsingVPG },
	then: {
		properties: { RAIDLevel: RAIDLevelScheme, ...limitationsProperties },
		dependencies: limitationsDependencies,
	}
};

const commonCustomProperties = {
	RAIDLevel: RAIDLevelScheme,
	type: { enum: Object.values(consts.volumeTypes) },
	isEncrypted: { type: 'boolean', default: false },
	encryption: { $ref: consts.MANAGEMENT_DEFINITIONS + '/volumeEncryption.js' },
	VSGs: { $ref: consts.MANAGEMENT_DEFINITIONS + '/vsgNamesList.js' },
};

const cdvConfigScheme = {
	type: 'object',
	unevaluatedProperties: false,
	properties: {
		cdvExtentSizeMib: { type: 'integer', enum: consts.cdvExtentSizeMibValues },
		allocatorSizeGib: { type: 'integer', default: 1, minimum: 1 },
		maxTPVs: { type: 'integer', default: 512, minimum: 1 },
		// Note: cdvConfig.admissionFloor is a server-owned field populated by
		// prepareCDVForCreate and mutated only by preemptClientFromCDV in
		// modules/volume.js. It is intentionally NOT listed here so that
		// unevaluatedProperties: false rejects user-supplied values with a
		// clean 400.
	},
};

const tpvConfigScheme = {
	type: 'object',
	unevaluatedProperties: false,
	properties: {
		cdvId: { type: 'string', minLength: 1 },
		cdvUUID: { type: 'string' },
		tpvExtentSizeKB: { type: 'integer', enum: consts.tpvExtentSizeKBValues },
		exclusiveClient: { type: ['string', 'null'], default: null },
		exclusiveClientUUID: { type: ['string', 'null'], default: null },
	},
};

const isTPV = { properties: { volumeClass: { const: 'TPV' } }, required: ['volumeClass'] };
const isCDV = { properties: { volumeClass: { const: 'CDV' } }, required: ['volumeClass'] };

const scheme = {
	$id: consts.MANAGEMENT_DEFINITIONS + '/volume.js',
	type: 'object',
	unevaluatedProperties: false,
	properties: {
		VPG: vpgScheme,
		capacity: { $ref: consts.MANAGEMENT_DEFINITIONS + '/capacity.js' },
		description: { $ref: consts.MANAGEMENT_DEFINITIONS + '/description.js' },
		sourceID: { type: 'string' },
		sourceUUID: { $ref: consts.MANAGEMENT_DEFINITIONS + '/uuid.js' },
		allowAllocationOnOfflineDrives: { type: 'boolean', default: false },
		isReadOnly: { type: 'boolean', default: false },
		mdvSpec: mdvSpecScheme,
		relativeRebuildPriority: { $ref: consts.MANAGEMENT_DEFINITIONS + '/relativeRebuildPriority.js' },
		enableNVMf: { type: 'boolean', default: false },
		metadata: { $ref: consts.MANAGEMENT_DEFINITIONS + '/volumeMetadata.js', default: {} },
		use_debug_di: { type: 'boolean', default: false },
		volumeClass: { type: 'string', enum: Object.values(consts.volumeClass), default: 'REGULAR' },
		tpvCount: { type: 'integer', default: 0, minimum: 0 },
		cdvConfig: cdvConfigScheme,
		tpvConfig: tpvConfigScheme,
	},
	if: { properties: { enableNVMf: { const: true } }, required: ['enableNVMf'] },
	then: {
		properties: {
			name: { $ref: consts.MANAGEMENT_DEFINITIONS + '/volumeNameWithNVMFAccess.js' },
			selectedClientsForNvmf: { type: 'array', items: { type: 'string' } }
		},
		required: ['selectedClientsForNvmf']
	},
	else: { properties: { name: { $ref: consts.MANAGEMENT_DEFINITIONS + '/volumeName.js' } } },
	required: ['name'],
	allOf: [
		{
			// set pRaidOptions, limitations and common properties if not using VPG
			if: { not: isUsingVPG },
			then: {
				properties: { ...commonCustomProperties, ...limitationsProperties, },
				dependencies: limitationsDependencies,
				...pRaidOptionsPropertiesConditions
			}
		},
		encryptionPropertiesConditions,
		{
			// capacity required for all volume types (TPVs use it as virtual size)
			required: ['capacity']
		},
		{
			// RAIDLevel required when not using VPG, except for TPV (which inherits RAID from its CDV)
			if: { allOf: [{ properties: { VPG: { maxLength: 0 } } }, { not: isTPV }] },
			then: { required: ['RAIDLevel'] }
		},
		{
			// CDV: cdvConfig required; cdvExtentSizeMib required within it.
			// CDV name uses the stricter cdvVolumeName scheme (≤16 chars,
			// no -mgmt suffix) so that '<cdvName>-mgmt' fits the volumeName limit.
			if: isCDV,
			then: {
				required: ['cdvConfig'],
				properties: {
					cdvConfig: { required: ['cdvExtentSizeMib'] },
					name: { $ref: consts.MANAGEMENT_DEFINITIONS + '/cdvVolumeName.js' }
				}
			}
		},
		{
			// TPV: tpvConfig required; cdvId and tpvExtentSizeKB required within it
			if: isTPV,
			then: {
				required: ['tpvConfig'],
				properties: { tpvConfig: { required: ['cdvId', 'tpvExtentSizeKB'] } }
			}
		},
	],
	dependencies: {
		sourceID: {
			if: { properties: { sourceID: { minLength: 1 } } },
			then: { required: ['sourceUUID'] }
		},
		sourceUUID: {
			if: { properties: { sourceUUID: { minLength: 1 } } },
			then: { required: ['sourceID'] }
		},
	}
};

module.exports = scheme;
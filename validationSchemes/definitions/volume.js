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
	required: ['capacity', 'name'],
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
			// allow request with VPG and without RAIDLevel ( If VPG not given -> require RAIDLevel )
			if: { properties: { VPG: { maxLength: 0 } } },
			then: { required: ['RAIDLevel'] }
		}
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
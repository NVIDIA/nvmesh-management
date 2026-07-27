const consts = require('../../consts.js');
const { pRaidOptionsPropertiesConditions } = require('../common/pRaidOptions.js');
const { encryptionPropertiesConditions } = require('../common/encryption.js');
const { classesScheme } = require('../common/volumeLimitations.js');

const scheme = {
	$id: consts.MANAGEMENT_DEFINITIONS + '/vpg.js',
	type: 'object',
	unevaluatedProperties: false,
	properties: {
		name: { $ref: consts.MANAGEMENT_DEFINITIONS + '/vpgName.js' },
		RAIDLevel: { enum: Object.values(consts.RAIDLevel) },
		capacity: { anyOf: [{ $ref: consts.MANAGEMENT_DEFINITIONS + '/capacity.js' }, { const: 0 }], default: 0 },
		description: { $ref: consts.MANAGEMENT_DEFINITIONS + '/description.js' },
		allowAllocationOnOfflineDrives: { type: 'boolean', default: false },
		diskClasses: classesScheme,
		serverClasses: classesScheme,
		VSGs: { $ref: consts.MANAGEMENT_DEFINITIONS + '/vsgNamesList.js' },
		allowOverflow: { type: 'boolean', default: true },
		type: { enum: Object.values(consts.volumeTypes) },
		isEncrypted: { type: 'boolean', default: false },
		encryption: { $ref: consts.MANAGEMENT_DEFINITIONS + '/volumeEncryption.js' },
		domain: { $ref: consts.MANAGEMENT_DEFINITIONS + '/domain.js#/properties/scope' },
	},
	required: ['name', 'capacity', 'RAIDLevel'],
	allOf: [
		// set pRaidOptions
		pRaidOptionsPropertiesConditions,
		encryptionPropertiesConditions,
	],
	dependencies: {
		type: {
			if: { properties: { type: { const: consts.volumeTypes.METADATA_VOLUME } } },
			then: { properties: { RAIDLevel: { const: consts.defaultMetadataRAIDLevel } } }
		}
	}
};

module.exports = scheme;
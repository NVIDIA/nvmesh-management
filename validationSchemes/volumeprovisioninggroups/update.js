const consts = require('../../consts.js');

const scheme = {
	$id: 'http://management/volumeprovisioninggroups/update.js',
	properties: {
		body: {
			type: 'array',
			items: {
				type: 'object',
				unevaluatedProperties: false,
				properties: {
					_id: { $ref: consts.MANAGEMENT_DEFINITIONS + '/vpgName.js' },
					uuid: { $ref: consts.MANAGEMENT_DEFINITIONS + '/uuid.js' },
					description: { $ref: consts.MANAGEMENT_DEFINITIONS + '/description.js' },
					VSGs: { $ref: consts.MANAGEMENT_DEFINITIONS + '/vsgNamesList.js' },
					allowAllocationOnOfflineDrives: { type: 'boolean' }
				},
				required: ['_id', 'uuid']
			},
			minItems: 1
		}
	},
	required: ['body']
};

module.exports = scheme;
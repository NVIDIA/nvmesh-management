var consts = require('../../consts.js');

var scheme = {
	$id: 'http://management/volumeprovisioninggroups/delete.js',
	properties: {
		body: {
			type: 'array',
			items: {
				type: 'object',
				properties: {
					_id: { $ref: consts.MANAGEMENT_DEFINITIONS + '/vpgName.js' },
					uuid: { $ref: consts.MANAGEMENT_DEFINITIONS + '/uuid.js' }
				},
				required: ['_id', 'uuid']
			},
			minItems: 1
		}
	}
};

module.exports = scheme;
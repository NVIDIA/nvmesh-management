let consts = require('../../consts.js');

let scheme = {
	$id: 'http://management/configurationprofiles/delete.js',
	properties: {
		body: {
			type: 'array',
			items: {
				type: 'object',
				properties: {
					uuid: { $ref: consts.MANAGEMENT_DEFINITIONS + '/uuid.js' }
				},
				required: ['_id', 'uuid']
			},
			minItems: 1
		}
	}
};

module.exports = scheme;
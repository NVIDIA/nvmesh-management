const consts = require('../../consts.js');
const scheme = {
	$id: 'http://management/servers/evict.js',
	properties: {
		body: {
			type: 'array',
			items: {
				type: 'object',
				properties: {
					_id: { $ref: consts.MANAGEMENT_DEFINITIONS + '/objectID.js#/properties/_id' },
					uuid: { $ref: consts.MANAGEMENT_DEFINITIONS + '/uuid.js' }
				},
				required: ['_id', 'uuid']
			},
			minItems: 1
		}
	},
	required: ['body']
};

module.exports = scheme;
const consts = require('../../consts.js');
const scheme = {
	$id: 'http://management/serverclasses/delete.js',
	properties: {
		body: {
			type: 'array',
			items: {
				type: 'object',
				properties: {
					_id: { $ref: consts.MANAGEMENT_DEFINITIONS + '/className.js' },
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
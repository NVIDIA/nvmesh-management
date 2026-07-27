const consts = require('../../consts');

const schema = {
	$id: 'http://management/definitions/release.js',
	type: 'object',
	properties: {
		version: { $ref: consts.MANAGEMENT_DEFINITIONS + '/version.js' },
		artifacts: {
			type: 'array',
			items: {
				type: 'object',
				properties: {
					ID: { type: 'integer' }
				},
				required: ['ID']
			},
		}
	},
	required: ['version']
};

module.exports = schema;
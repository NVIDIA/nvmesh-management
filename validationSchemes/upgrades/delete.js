const consts = require('../../consts');

const schema = {
	$id: 'http://management/upgrades/delete.js',
	properties: {
		body: {
			type: 'array',
			items: { $ref: consts.MANAGEMENT_DEFINITIONS + '/objectID.js' },
			minItems: 1
		}
	},
	required: ['body']
};

module.exports = schema;

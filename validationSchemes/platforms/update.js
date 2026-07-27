const consts = require('../../consts.js');

const schema = {
	$id: 'http://management/platforms/update.js',
	properties: {
		body: {
			type: 'array',
			items: { $ref: consts.MANAGEMENT_DEFINITIONS + '/platform.js' },
			minItems: 1
		}
	},
	required: ['body']
};

module.exports = schema;
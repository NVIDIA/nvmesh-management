const consts = require('../../consts.js');

const schema = {
	$id: 'http://management/components/save.js',
	properties: {
		body: {
			type: 'array',
			items: { $ref: consts.MANAGEMENT_DEFINITIONS + '/component.js' },
			minItems: 1
		}
	},
	required: ['body']
};

module.exports = schema;
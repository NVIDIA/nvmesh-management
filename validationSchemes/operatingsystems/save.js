const consts = require('../../consts');

const schema = {
	$id: 'http://management/operatingsystems/save.js',
	properties: {
		body: {
			type: 'array',
			items: { $ref: consts.MANAGEMENT_DEFINITIONS + '/operatingSystem.js' },
			minItems: 1
		}
	},
	required: ['body']
};

module.exports = schema;

const consts = require('../../consts');

const schema = {
	$id: 'http://management/operatingSystems/update.js',
	properties: {
		body: {
			type: 'array',
			items: { $ref: consts.MANAGEMENT_DEFINITIONS + '/operatingSystemWithID.js' },
			minItems: 1
		}
	},
	required: ['body']
};

module.exports = schema;

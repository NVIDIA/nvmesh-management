
const consts = require('../../consts.js');

const schema = {
	$id: 'http://management/artifacts/save.js',
	properties: {
		body: {
			type: 'array',
			items: { $ref: consts.MANAGEMENT_DEFINITIONS + '/artifact.js' },
			minItems: 1
		}
	},
	required: ['body']
};

module.exports = schema;
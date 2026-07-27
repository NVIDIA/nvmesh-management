const consts = require('../../consts');
const scheme = {
	$id: 'http://management/keys/update.js',
	properties: {
		body: {
			type: 'array',
			items: { $ref: consts.MANAGEMENT_DEFINITIONS + '/key.js' },
			minItems: 1
		}
	},
	required: ['body']
};

module.exports = scheme;
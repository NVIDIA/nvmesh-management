const consts = require('../../consts');

const schema = {
	$id: 'http://management/upgrades/save.js',
	properties: {
		body: { $ref: consts.MANAGEMENT_DEFINITIONS + '/upgrade.js' }
	},
	required: ['body']
};

module.exports = schema;

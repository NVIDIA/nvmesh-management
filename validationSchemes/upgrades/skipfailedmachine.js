const consts = require('../../consts');

const schema = {
	$id: 'http://management/upgrades/skipfailedmachine.js',
	properties: {
		body: { $ref: consts.MANAGEMENT_DEFINITIONS + '/objectID.js' }
	},
	required: ['body']
};

module.exports = schema;
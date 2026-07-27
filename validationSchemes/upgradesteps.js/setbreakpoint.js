const consts = require('../../consts');

const schema = {
	$id: 'http://management/upgrades/setbreakpoint.js',
	properties: {
		body: {
			$ref: consts.MANAGEMENT_DEFINITIONS + '/upgradeBreakpoint.js'
		}
	},
	required: ['body']
};

module.exports = schema;

const consts = require('../../consts');

const schema = {
	$id: 'http://management/upgrades/markascompleted.js',
	properties: {
		body: {
			$ref: consts.MANAGEMENT_DEFINITIONS + '/markUpgradeCompleted.js'
		}
	},
	required: ['body']
};

module.exports = schema;

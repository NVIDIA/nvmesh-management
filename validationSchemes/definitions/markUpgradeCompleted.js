const consts = require('../../consts');

const schema = {
	$id: consts.MANAGEMENT_DEFINITIONS + '/markUpgradeCompleted.js',
	type: 'object',
	properties: {
		upgradeStepID: { type: 'string' },
	},
	required: ['upgradeStepID']
};

module.exports = schema;

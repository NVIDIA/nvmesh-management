const consts = require('../../consts');

const schema = {
	$id: consts.MANAGEMENT_DEFINITIONS + '/upgradeBreakpoint.js',
	type: 'object',
	properties: {
		upgradeStepID: { type: 'string' },
		isBreakpointSet: { type: 'boolean' }
	},
	required: ['upgradeStepID', 'isBreakpointSet']
};

module.exports = schema;

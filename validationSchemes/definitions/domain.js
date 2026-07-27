var consts = require('../../consts.js');
var scheme = {
	$id: consts.MANAGEMENT_DEFINITIONS + '/domain.js',
	type: 'object',
	properties: {
		scope: { $ref: consts.MANAGEMENT_DEFINITIONS + '/domainConstraints.js' },
		identifier: { $ref: consts.MANAGEMENT_DEFINITIONS + '/domainConstraints.js' }
	},
	required: ['scope', 'identifier']
};

module.exports = scheme;
var consts = require('../../consts.js');
var scheme = {
	$id: consts.MANAGEMENT_DEFINITIONS + '/pagination.js',
	type: 'object',
	properties: {
		page: {
			type: 'number',
			minimum: 0
		},
		count: {
			type: 'number',
			minimum: 0
		}
	}
};

module.exports = scheme;
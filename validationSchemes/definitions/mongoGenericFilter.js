var consts = require('../../consts.js');
var scheme = {
	$id: consts.MANAGEMENT_DEFINITIONS + '/mongoGenericFilter.js',
	type: 'object',
	properties: {
		filter: {
			type: 'string',
			format: 'json'
		}
	}
};

module.exports = scheme;
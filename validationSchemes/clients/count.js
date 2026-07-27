var consts = require('../../consts.js');
var scheme = {
	$id: 'http://management/clients/count.js',
	properties: {
		query: { $ref: consts.MANAGEMENT_DEFINITIONS + '/mongoGenericFilter.js' }
	}
};

module.exports = scheme;
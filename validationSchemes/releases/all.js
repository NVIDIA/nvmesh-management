var consts = require('../../consts.js');
var scheme = {
	$id: 'http://management/releases/all.js',
	properties: {
		params: { $ref: consts.MANAGEMENT_DEFINITIONS + '/pagination.js' },
		query: { $ref: consts.MANAGEMENT_DEFINITIONS + '/filterSortAndProjection.js' }
	}
};

module.exports = scheme;
var consts = require('../../consts.js');
var scheme = {
	$id: 'http://management/platforms/all.js',
	properties: {
		query: { $ref: consts.MANAGEMENT_DEFINITIONS + '/filterSortAndProjection.js' }
	}
};

module.exports = scheme;
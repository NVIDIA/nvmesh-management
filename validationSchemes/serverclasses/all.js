var consts = require('../../consts.js');
var scheme = {
	$id: 'http://management/serverclasses/all.js',
	properties: {
		query: { $ref: consts.MANAGEMENT_DEFINITIONS + '/filterSortAndProjection.js' }
	}
};

module.exports = scheme;
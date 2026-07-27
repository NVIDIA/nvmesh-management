const consts = require('../../consts.js');
const scheme = {
	$id: 'http://management/upgradestepsscenarios/all.js',
	properties: {
		params: { $ref: consts.MANAGEMENT_DEFINITIONS + '/pagination.js' },
		query: { $ref: consts.MANAGEMENT_DEFINITIONS + '/filterSortAndProjection.js' }
	}
};

module.exports = scheme;


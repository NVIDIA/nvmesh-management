var consts = require('../../consts.js');
var scheme = {
	$id: 'http://management/operatingsystems/distributiontypes.js',
	properties: {
		query: {
			filter: { $ref: consts.MANAGEMENT_DEFINITIONS + '/jsonObject.js' },
			sort: { $ref: consts.MANAGEMENT_DEFINITIONS + '/jsonObject.js' },
		}

	}
};

module.exports = scheme;
const consts = require('../../consts.js');
const scheme = {
	$id: 'http://management/operatingsystems/count.js',
	properties: {
		query: { $ref: consts.MANAGEMENT_DEFINITIONS + '/mongoGenericFilter.js' }
	}
};

module.exports = scheme;
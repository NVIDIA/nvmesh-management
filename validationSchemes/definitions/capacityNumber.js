var consts = require('../../consts.js');
var scheme = {
	$id: consts.MANAGEMENT_DEFINITIONS + '/capacityNumber.js',
	type: 'number',
	minimum: 1,
	maximum: Number.MAX_SAFE_INTEGER
};

module.exports = scheme;
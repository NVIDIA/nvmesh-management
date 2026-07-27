var consts = require('../../consts.js');
var scheme = {
	$id: consts.MANAGEMENT_DEFINITIONS + '/relativeRebuildPriority.js',
	type: 'integer',
	minimum: 0,
	maximum: 10,
	default: 10
};

module.exports = scheme;
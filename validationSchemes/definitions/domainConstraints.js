var consts = require('../../consts.js');

var scheme = {
	$id: consts.MANAGEMENT_DEFINITIONS + '/domainConstraints.js',
	type: 'string',
	pattern: '^[\\w _\\-]{1,32}$'
};
module.exports = scheme;
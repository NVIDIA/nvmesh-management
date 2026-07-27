var consts = require('../../consts.js');
var scheme = {
	$id: consts.MANAGEMENT_DEFINITIONS + '/className.js',
	type: 'string',
	pattern: '^[\\w\\-]{1,1024}$'
};

module.exports = scheme;
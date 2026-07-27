var consts = require('../../consts.js');
var scheme = {
	$id: consts.MANAGEMENT_DEFINITIONS + '/vpgName.js',
	type: 'string',
	pattern: '^(?!e_|d_)[\\w+=-]*$',
	maxLength: 22,
	minLength: 1
};

module.exports = scheme;
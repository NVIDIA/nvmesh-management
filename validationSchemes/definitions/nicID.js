var consts = require('../../consts.js');
var scheme = {
	$id: consts.MANAGEMENT_DEFINITIONS + '/nicID.js',
	type: 'string',
	pattern: '0x[a-fA-F0-9]{32}'
};

module.exports = scheme;
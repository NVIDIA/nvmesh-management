var consts = require('../../consts.js');
var scheme = {
	$id: consts.MANAGEMENT_DEFINITIONS + '/passphrase.js',
	type: 'string',
	pattern: '^.{8,4096}$'
};

module.exports = scheme;
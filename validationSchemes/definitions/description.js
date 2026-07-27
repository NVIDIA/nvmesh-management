var consts = require('../../consts.js');
var scheme = {
	$id: consts.MANAGEMENT_DEFINITIONS + '/description.js',
	anyOf: [{ type: 'string', maxLength: 1024 }, { type: 'null' }]
};

module.exports = scheme;
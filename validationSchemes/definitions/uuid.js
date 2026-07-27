let consts = require('../../consts.js');

let scheme = {
	$id: consts.MANAGEMENT_DEFINITIONS + '/uuid.js',
	type: 'string',
	format: 'uuid'
};

module.exports = scheme;
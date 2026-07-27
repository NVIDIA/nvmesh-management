const consts = require('../../consts.js');
const scheme = {
	$id: consts.MANAGEMENT_DEFINITIONS + '/referenceID.js',
	type: 'string',
	minLength: 1,
	maxLength: 63,
	pattern: '^[a-z0-9-]+$'
};

module.exports = scheme;
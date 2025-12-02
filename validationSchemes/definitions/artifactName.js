const consts = require('../../consts.js');

const schema = {
	$id: consts.MANAGEMENT_DEFINITIONS + '/artifactName.js',
	type: 'string',
	maxLength: 1024,
	minLength: 1,
	pattern: '^[a-zA-Z0-9_.*-]+$',
};

module.exports = schema;
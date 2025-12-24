const consts = require('../../consts.js');

const schema = {
	$id: consts.MANAGEMENT_DEFINITIONS + '/artifactName.js',
	type: 'string',
	maxLength: 1024,
	minLength: 1,
	pattern: consts.artifactNameRegex.source,
};

module.exports = schema;
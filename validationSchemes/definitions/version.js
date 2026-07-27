const schema = {
	$id: 'http://management/definitions/version.js',
	type: 'string',
	pattern: '^[a-zA-Z0-9_.-]+$'
};

module.exports = schema;
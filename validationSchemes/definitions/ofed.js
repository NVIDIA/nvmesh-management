const schema = {
	$id: 'http://management/definitions/ofed.js',
	type: 'object',
	properties: {
		ID: { type: 'integer' },
		version: { type: 'string' }
	},
	required: ['ID', 'version']
};

module.exports = schema;
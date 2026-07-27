const schema = {
	$id: 'http://management/definitions/operatingSystem.js',
	type: 'object',
	properties: {
		version: { type: 'string' },
		distributionTypeID: { type: 'integer' }
	},
	required: ['version', 'distributionTypeID']
};

module.exports = schema;

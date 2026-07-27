const schema = {
	$id: 'http://management/releases/save.js',
	properties: {
		body: {
			type: 'array',
			items: { $ref: 'http://management/definitions/release.js' },
			minItems: 1
		}
	},
	required: ['body']
};

module.exports = schema;
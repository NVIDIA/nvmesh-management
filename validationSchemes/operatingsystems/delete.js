const schema = {
	$id: 'http://management/operatingsystems/delete.js',
	properties: {
		body: {
			type: 'array',
			items: {
				type: 'object',
				properties: {
					ID: { type: 'integer' },
					version: { type: 'string' }
				},
				required: ['ID', 'version']
			},
			minItems: 1
		}
	},
	required: ['body']
};

module.exports = schema;

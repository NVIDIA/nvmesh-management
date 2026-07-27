const schema = {
	$id: 'http://management/platforms/delete.js',
	properties: {
		body: {
			type: 'array',
			minItems: 1,
			items: {
				type: 'object',
				properties: {
					ID: { type: 'integer' },
					name: { type: 'string' }
				},
				required: ['ID', 'name']
			}
		}
	},
	required: ['body']
};

module.exports = schema;

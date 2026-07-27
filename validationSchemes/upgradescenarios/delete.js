const schema = {
	$id: 'http://management/upgradescenarios/delete.js',
	properties: {
		body: {
			type: 'array',
			minItems: 1,
			items: {
				type: 'object',
				properties: {
					ID: { type: 'integer' }
				},
				required: ['ID']
			}
		}
	},
	required: ['body']
};

module.exports = schema;


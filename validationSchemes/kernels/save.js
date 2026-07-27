const schema = {
	$id: 'http://management/kernels/save.js',
	properties: {
		body: {
			type: 'array',
			items: { type: 'string' },
			minItems: 1
		}
	},
	required: ['body']
};

module.exports = schema;
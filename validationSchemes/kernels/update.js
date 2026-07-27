const schema = {
	$id: 'http://management/kernels/update.js',
	properties: {
		body: {
			type: 'array',
			items: { $ref: 'http://management/definitions/kernel.js' },
			minItems: 1
		}
	},
	required: ['body']
};

module.exports = schema;
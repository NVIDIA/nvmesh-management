const schema = {
	$id: 'http://management/ofeds/delete.js',
	properties: {
		body: {
			type: 'array',
			items: { $ref: 'http://management/definitions/ofed.js' },
			minItems: 1
		}
	},
	required: ['body']
};

module.exports = schema;
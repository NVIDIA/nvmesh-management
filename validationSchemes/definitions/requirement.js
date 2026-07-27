module.exports = {
	$id: 'http://management/definitions/requirement.js',
	type: 'object',
	properties: {
		ID: { type: 'integer' },
		name: { type: 'string' },
		componentTypeID: { type: 'integer' },
		componentType: {
			type: 'object',
			properties: {
				ID: { type: 'integer' },
				name: { type: 'string' }
			},
			required: ['ID', 'name']
		}
	},
	required: ['ID', 'name', 'componentTypeID', 'componentType']
};
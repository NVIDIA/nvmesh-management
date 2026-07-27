const schema = {
	$id: 'http://management/definitions/upgradeScenario.js',
	type: 'object',
	properties: {
		ID: { type: 'integer' },
		upgradeTypeID: { type: 'integer' },
		destinationReleaseID: { type: 'integer' },
		sourceVersionID: { type: 'integer' },
		steps: {
			type: 'array',
			items: {
				type: 'object',
				properties: {
					ID: { type: 'integer' }
				},
				required: ['ID']
			}
		}
	}
};

module.exports = schema;


const schema = {
	$id: 'http://management/upgrades/getpossibleupgrades.js',
	type: 'object',
	properties: {
		query: {
			type: 'object',
			properties: {
				isClientOnly: { type: 'boolean' },
				sourceVersion: { type: 'string' }
			}
		}
	}
};

module.exports = schema;
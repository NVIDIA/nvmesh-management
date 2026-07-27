const osBase = require('./operatingSystem');

const schema = {
	$id: 'http://management/definitions/operatingSystemWithID.js',
	type: 'object',
	properties: {
		ID: { type: 'integer' },
		...osBase.properties
	},
	required: ['ID', ...osBase.required]
};

module.exports = schema;

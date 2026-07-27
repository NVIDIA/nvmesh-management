const utils = require('../../utils');
const diskClassSchema = require('../definitions/diskClass');
const diskClassSaveSchema = utils.extend(true, {}, diskClassSchema);
diskClassSaveSchema.$id = 'http://management/diskclasses/diskClassSave.js';
diskClassSaveSchema.properties.domains.default = [];

const schema = {
	$id: 'http://management/diskclasses/save.js',
	properties: {
		body: {
			type: 'array',
			items: diskClassSaveSchema,
			minItems: 1
		}
	},
	required: ['body']
};

module.exports = schema;
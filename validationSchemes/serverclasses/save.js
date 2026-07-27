const utils = require('../../utils');
const serverClassSchema = require('../definitions/serverClass');
const serverClassSaveSchema = utils.extend(true, {}, serverClassSchema);
serverClassSaveSchema.$id = 'http://management/serverclasses/serverClassSave.js';
serverClassSaveSchema.properties.domains.default = [];

const scheme = {
	$id: 'http://management/serverclasses/save.js',
	properties: {
		body: {
			type: 'array',
			items: serverClassSaveSchema,
			minItems: 1
		}
	},
	required: ['body']
};

module.exports = scheme;
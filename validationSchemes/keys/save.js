const utils = require('../../utils');
const keyScheme = require('../definitions/key');

const keySaveScheme = utils.extend(true, {}, keyScheme);
keySaveScheme.$id = 'http://management/keys/keysSave.js';
keySaveScheme.required = keySaveScheme.required.filter(k => k !== 'uuid');

const scheme = {
	$id: 'http://management/keys/save.js',
	properties: {
		body: {
			type: 'array',
			items: keySaveScheme,
			minItems: 1
		}
	},
	required: ['body']
};

module.exports = scheme;
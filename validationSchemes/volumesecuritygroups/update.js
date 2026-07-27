const consts = require('../../consts');
const utils = require('../../utils');
const vsgScheme = require('../definitions/vsg');
const vsgUpdateScheme = utils.extend(true, {}, vsgScheme);

vsgUpdateScheme.$id = 'http://management/vsg/vsgUpdate.js';
vsgUpdateScheme.properties.uuid = { $ref: consts.MANAGEMENT_DEFINITIONS + '/uuid.js' };
vsgUpdateScheme.required.push('uuid');

const scheme = {
	$id: 'http://management/volumesecuritygroups/update.js',
	properties: {
		body: {
			type: 'array',
			items: vsgUpdateScheme,
			minItems: 1
		}
	},
	required: ['body']
};

module.exports = scheme;
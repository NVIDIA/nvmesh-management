const consts = require('../../consts');
const utils = require('../../utils');
const vpgScheme = require('../definitions/vpg');
const vpgCreateScheme = utils.extend(true, {}, vpgScheme);

vpgCreateScheme.$id = consts.MANAGEMENT_DEFINITIONS + '/vpgCreate.js';

const vpgsCreateScheme = {
	$id: consts.MANAGEMENT_DEFINITIONS + '/vpgsCreate.js',
	type: 'array',
	items: vpgCreateScheme,
	minItems: 1
};

module.exports = vpgsCreateScheme;
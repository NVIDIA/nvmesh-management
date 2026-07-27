const utils = require('../../utils');
const consts = require('../../consts.js');
const vpgName = require('./vpgName');

const scheme = utils.extend(true, {}, vpgName);

scheme.$id = consts.MANAGEMENT_DEFINITIONS + '/existingVpgName.js';
scheme.maxLength = 100; // support default vpg names (>22 chars) - i.e. DEFAULT_CONCATENATED_VPG

module.exports = scheme;
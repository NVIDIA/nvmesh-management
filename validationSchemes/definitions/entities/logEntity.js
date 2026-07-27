var consts = require('../../../consts.js');
var logScheme = require('../log.js');
var utils = require('../../../utils.js');

var logEntityScheme = utils.extend(true, {}, logScheme);

logEntityScheme['$id'] = consts.MANAGEMENT_DEFINITIONS_ENTITIES + '/logEntity.js';

module.exports = logEntityScheme;
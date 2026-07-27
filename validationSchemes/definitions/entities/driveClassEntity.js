var consts = require('../../../consts.js');
var diskClassScheme = require('../diskClass.js');
var utils = require('../../../utils.js');

var driveClassEntityScheme = utils.extend(true, {}, diskClassScheme);

driveClassEntityScheme['$id'] = consts.MANAGEMENT_DEFINITIONS_ENTITIES + '/driveClassEntity.js';

module.exports = driveClassEntityScheme;
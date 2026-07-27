const saveScheme = require('./save.js');
const driveClassScheme = require('../definitions/diskClass.js');
const utils = require('../../utils.js');
const consts = require('../../consts.js');

const updateScheme = utils.extend(true, {}, saveScheme);
const driveClassUpdateScheme = utils.extend(true, {}, driveClassScheme);

driveClassUpdateScheme.$id = 'http://management/diskclasses/updateDriveClass.js';
driveClassUpdateScheme.properties.uuid = { $ref: consts.MANAGEMENT_DEFINITIONS + '/uuid.js' };

updateScheme.$id = 'http://management/diskclasses/update.js';
updateScheme.properties.body.items = driveClassUpdateScheme;
updateScheme.properties.body.items.required.push('uuid');

module.exports = updateScheme;
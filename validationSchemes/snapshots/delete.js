var deleteVolumeScheme = require('../volumes/delete.js');
var utils = require('../../utils.js');

var deleteSnapshotScheme = utils.extend(true, {}, deleteVolumeScheme);
deleteSnapshotScheme['$id'] = deleteSnapshotScheme['$id'].replace('volumes', 'snapshots');

module.exports = deleteSnapshotScheme;
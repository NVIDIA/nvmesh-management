var attachScheme = require('./attach.js');
var utils = require('../../utils.js');

var detachScheme = utils.extend(true, {}, attachScheme);
detachScheme['$id'] = detachScheme['$id'].replace('attach', 'detach');

module.exports = detachScheme;
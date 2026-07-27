var scheme = require('./all.js');
var utils = require('../../utils.js');

scheme = utils.extend(true, {}, scheme);
scheme['$id'] = 'http://management/logs/alerts.js';

module.exports = scheme;
var consts = require('../../consts.js');
const utils = require('../../utils');
const attachVolumeScheme = require('../definitions/attachVolume.js');
const emulationVolumeScheme = utils.extend(true, {}, attachVolumeScheme);
emulationVolumeScheme.$id = consts.MANAGEMENT_DEFINITIONS + '/emulationVolume.js';
delete emulationVolumeScheme.properties.reservation;
emulationVolumeScheme.required.push('emulation');

var scheme = {
	$id: 'http://management/clients/setemulationmode.js',
	properties: {
		body: {
			type: 'object',
			properties: {
				client: { $ref: consts.MANAGEMENT_DEFINITIONS + '/objectID.js#/properties/_id' },
				clientUUID: { $ref: consts.MANAGEMENT_DEFINITIONS + '/uuid.js' },
				volumes: {
					type: 'array',
					items: emulationVolumeScheme,
					minItems: 1
				}
			},
			required: ['client', 'clientUUID', 'volumes']
		}
	},
	required: ['body']
};

module.exports = scheme;
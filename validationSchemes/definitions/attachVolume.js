var consts = require('../../consts.js');
var scheme = {
	$id: consts.MANAGEMENT_DEFINITIONS + '/attachVolume.js',
	type: 'object',
	properties: {
		name: { $ref: consts.MANAGEMENT_DEFINITIONS + '/volumeName.js' },
		uuid: { $ref: consts.MANAGEMENT_DEFINITIONS + '/uuid.js' },
		reservation: {
			type: 'object',
			properties: {
				mode: {
					enum: [
						consts.reservationModeNames.SHARED_READ_ONLY,
						consts.reservationModeNames.SHARED_READ_WRITE,
						consts.reservationModeNames.EXCLUSIVE_READ_WRITE
					],
					default: consts.reservationModeNames.SHARED_READ_WRITE
			 },
				version: { type: 'integer' },
				preempt: { type: 'boolean' },
				isDetachOthers: { type: 'boolean', default: false }
			},
			required: ['mode']
		},
		emulation: {
			type: 'object',
			properties: {
				mode: { enum: [
					consts.emulationModeNames.NONE,
					consts.emulationModeNames.STATIC,
					consts.emulationModeNames.HOTPLUG
				] }
			},
			required: ['mode']
		},
		referenceID: { $ref: consts.MANAGEMENT_DEFINITIONS + '/referenceID.js' }
	},
	required: ['name', 'uuid'],
};

module.exports = scheme;
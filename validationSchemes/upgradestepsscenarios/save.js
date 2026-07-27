const utils = require('../../utils.js');
const upgradeStepScenarioSchema = require('../definitions/upgradeStepScenario.js');

const upgradeStepScenarioSaveSchema = utils.extend(true, {}, upgradeStepScenarioSchema);
upgradeStepScenarioSaveSchema.$id = 'http://management/upgradestepsscenarios/upgradeStepScenarioSave.js';
upgradeStepScenarioSaveSchema.required = ['name', 'command'];
upgradeStepScenarioSaveSchema.properties.ID = { type: 'null' };

const schema = {
	$id: 'http://management/upgradestepsscenarios/save.js',
	properties: {
		body: {
			type: 'array',
			items: upgradeStepScenarioSaveSchema,
			minItems: 1
		}
	},
	required: ['body']
};

module.exports = schema;


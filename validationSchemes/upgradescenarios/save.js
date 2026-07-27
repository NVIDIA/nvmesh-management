const utils = require('../../utils.js');
const upgradeScenarioSchema = require('../definitions/upgradeScenario.js');

const upgradeScenarioSaveSchema = utils.extend(true, {}, upgradeScenarioSchema);
upgradeScenarioSaveSchema.$id = 'http://management/upgradescenarios/upgradeScenarioSave.js';
upgradeScenarioSaveSchema.required = ['upgradeTypeID', 'destinationReleaseID', 'sourceVersionID'];
upgradeScenarioSaveSchema.properties.ID = { type: 'null' };
upgradeScenarioSaveSchema.properties.steps = { type: 'null' };

const schema = {
	$id: 'http://management/upgradescenarios/save.js',
	properties: {
		body: {
			type: 'array',
			items: upgradeScenarioSaveSchema,
			minItems: 1
		}
	},
	required: ['body']
};

module.exports = schema;


const { kafkaMessageTypes } = require('../../consts');
const { KafkaMessage } = require('./KafkaMessage');

exports.UpgradeAgentCommand = class UpgradeAgentCommand extends KafkaMessage {
	constructor(upgradeAgentID, upgradeAgentToken, step,
		type = kafkaMessageTypes.ManagementToUpgradeAgent.upgradeAgentCommand, version = 1) {
		super(type, version);

		this.upgradeAgentID = upgradeAgentID;
		this.upgradeAgentToken = upgradeAgentToken;
		this.upgradeStepID = step._id;
		this.command = step.command;
		this.verificationCommand = step.verificationCommand;
		this.timeout = step.timeout;
	}

	toJSON() {
		const json = super.toJSON();

		json['payload'] = {
			upgradeAgentToken: this.upgradeAgentToken,	
			upgradeAgentID: this.upgradeAgentID,
			upgradeStepID: this.upgradeStepID,
			command: this.command,
			verificationCommand: this.verificationCommand,
			timeout: this.timeout
		};

		return json;
	}
};
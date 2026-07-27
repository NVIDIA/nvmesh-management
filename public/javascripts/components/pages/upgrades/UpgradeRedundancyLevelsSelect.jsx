/* global React, consts */

import Select from '../../core/Select.jsx';

const options = [
	{
		text: 'Maximum',
		value: consts.upgradeRedundancyLevels.MAX,
		description: 'Ensure highest level of redundancy, Upgrade may take longer to complete'
	},
	{
		text: 'Minimal',
		value: consts.upgradeRedundancyLevels.MINIMAL,
		description: 'Maintain the minimal level of redundancy required to maintain data availability, Upgrade will complete faster'
	},
	{
		text: 'None',
		value: consts.upgradeRedundancyLevels.NONE,
		description: 'Will not maintain any redundancy, Upgrade will complete faster'
	}
];

const UpgradeRedundancyLevelsSelect = ({
	selectedRedundancyLevel,
	// eslint-disable-next-line no-unused-vars
	onChange = _ => {},
	placeholder = 'Choose redundancy level'
}) => {
	return (
		<Select id="redundancyLevel"
			placeholder={placeholder}
			value={selectedRedundancyLevel}
			onChange={onChange}
			options={options}
			render={{
				option: function(item, escape) {
					return '<div>' +
						'<strong>' + item.text + '</strong>' +
						'<br/>' +
						'<small>' + escape(item.description) + '</small>' +
						'</div>';
				}
			}}
		/>
	);
};

export default UpgradeRedundancyLevelsSelect;

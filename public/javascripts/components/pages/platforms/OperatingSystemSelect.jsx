/* global React */

import FormControl from '../../core/FormControl.jsx';
import Select from '../../core/Select.jsx';

const OperatingSystemSelect = ({
	operatingSystems = [],
	value,
	// eslint-disable-next-line no-unused-vars
	onChange = _ => {},
	placeholder = 'Choose operating system'
}) => {

	return (
		<FormControl label="Operating System" name="operatingSystem">
			<Select
				id="operatingSystems"
				placeholder={placeholder}
				value={value}
				onChange={onChange}
				options={operatingSystems}
				valueAsObject
				valueField="ID"
				labelField="version"
				searchField={['distributionType', 'version']}
				render={{
					option: (item, escape) => `<div>${escape(item.distributionType)} - ${escape(item.version)}</div>`,
					item: (item, escape) => `<div>${escape(item.distributionType)} - ${escape(item.version)}</div>`
				}}
			/>
		</FormControl>
	);
};

export default OperatingSystemSelect;

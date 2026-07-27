/* global React */

import FormControl from '../../core/FormControl.jsx';
import Select from '../../core/Select.jsx';

const ArchTypesSelect = ({
	archTypes = [],
	value,
	// eslint-disable-next-line no-unused-vars
	onChange = _ => {},
	placeholder = 'Choose system architecture'
}) => {
	return (
		<FormControl label="Architecture" name="arch">
			<Select
				id="archTypes"
				placeholder={placeholder}
				value={value}
				onChange={onChange}
				options={archTypes}
				valueAsObject
				valueField="ID"
				labelField="name"
				searchField="name"
			/>
		</FormControl>
	);
};

export default ArchTypesSelect;

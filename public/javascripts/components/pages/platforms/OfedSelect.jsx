/* global React */

import FormControl from '../../core/FormControl.jsx';
import Select from '../../core/Select.jsx';

const OfedSelect = ({
	ofeds = [],
	value,
	// eslint-disable-next-line no-unused-vars
	onChange = _ => {},
	placeholder = 'Choose ofed'
}) => {
	return (
		<FormControl label="Ofed" name="ofed">
			<Select
				id="ofeds"
				placeholder={placeholder}
				value={value}
				onChange={onChange}
				options={ofeds}
				valueAsObject
				valueField='ID'
				labelField='version'
				searchField='version'
			/>
		</FormControl>
	);
};

export default OfedSelect;

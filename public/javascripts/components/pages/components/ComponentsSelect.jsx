/* global React */

import FormControl from '../../core/FormControl.jsx';
import Select from '../../core/Select.jsx';

const ComponentsSelect = ({
	components = [],
	selectedComponent,
	// eslint-disable-next-line no-unused-vars
	onChange = _ => {},
	placeholder = 'Choose component'
}) => {
	return (
		<FormControl label="Component" name="component">
			<Select id="components"
				placeholder={placeholder}
				value={selectedComponent}
				onChange={onChange}
				options={components}
				valueAsObject
				valueField='ID'
				labelField='name'
				searchField='name'
			/>
		</FormControl>
	);
};

export default ComponentsSelect;

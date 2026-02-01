/* global React */

import RadioInput from './RadioInput.jsx';

const RadioInputGroup = ({ groupID, options, onChange }) => {
	return (
		<div className="radio-input-group">
			{options.map((option) => (
				<RadioInput
					key={option.value}
					value={option.value}
					label={option.label}
					disabled={option.disabled}
					checked={option.checked}
					name={groupID}
					onChange={onChange}
				/>
			))}
		</div>
	);
};

export default RadioInputGroup;

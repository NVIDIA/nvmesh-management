/* global React */

const ToggleButtonGroup = ({
	value,
	options,
	// eslint-disable-next-line no-unused-vars
	onChange = _ => {},
	...props
}) => {
	const onOptionSelected = (newValue) => {
		if (newValue !== value) {
			onChange(newValue);
		}
	};

	return (
		<div className="btn-group btn-group-toggle" {...props}>
			{options.map((option) => (
				<label key={option.value} className={`btn btn-default ${value === option.value ? 'active' : ''}`}>
					<input type="radio" name={option.value} onClick={() => onOptionSelected(option.value)} value={option.value}/>
					{option.label}
				</label>
			))}
		</div>
	);
};

export default ToggleButtonGroup;
/* global React */

const RadioInput = ({
	name,
	value,
	label,
	checked,
	onChange,
	children,
	disabled,
	...props
}) => {
	return (
		<div className="radio-input">
			<input
				id={value}
				type="radio"
				name={name}
				value={value}
				checked={checked}
				onChange={onChange}
				disabled={disabled}
				{...props}
			/>
			{label && <label disabled={disabled} htmlFor={value}>{label}</label>}
			{children}
		</div>
	);
};

export default RadioInput;
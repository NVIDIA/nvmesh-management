/* global React */

const { forwardRef } = React;

// eslint-disable-next-line react/display-name
const Toggle = forwardRef(({ id, isChecked, disabled = false, onChange = () => {} }, ref) => {

	const handleChange = newValue => {
		onChange(newValue);
	};

	return (
		<div className="toggle">
			<label className={`switch ${disabled ? 'disabled' : ''}`} htmlFor={id}>
				<input type="checkbox"
				       ref={ref}
				       id={id}
				       checked={isChecked}
				       disabled={disabled}
				       onChange={e => handleChange(e.target.checked)}
				/>
				<span className="slider round"></span>
			</label>
		</div>
	);
});


export default Toggle;
/* global React */

const Checkbox = ({
	id,
	checked,
	indeterminate,
	disabled,
	onChange
}) => {
	return (
		<div className="md-checkbox">
			<input
				id={id}
				type="checkbox"
				disabled={disabled}
				checked={checked}
				ref={(e) => {
					if (e && indeterminate !== undefined) {
						e.indeterminate = indeterminate;
					}
				}}
				onChange={onChange}
			/>
			<label htmlFor={id}></label>
		</div>
	);
};

export default Checkbox;
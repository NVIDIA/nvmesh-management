/* global React */
const { forwardRef } = React;

const Input = forwardRef(function FormInput({
	type = 'text',
	name,
	value,
	onChange,
	placeholder = '',
	className = '',
	disabled = false,
	required = false,
	...props
}, ref) {

	return (
		<input ref={ref}
		       type={type}
		       id={name}
		       name={name}
		       value={value}
		       placeholder={placeholder}
		       onChange={onChange}
		       disabled={disabled}
		       required={required}
		       className={className}
		       {...props}
		/>
	);
});

export default Input;

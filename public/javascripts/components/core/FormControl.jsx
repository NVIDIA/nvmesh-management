/* global React */

const FormControl = ({
	label,
	name,
	errorMessage,
	children,
	className = '',
	noAlertIcon = false,
	topHint,
	style = {},
}) => {

	const hasError = !!errorMessage;

	return (
		<div className={`form-group ${className} ${hasError ? 'has-error' : ''}`} style={style}>
			<div className="form-control-label-container">
				{label && <label htmlFor={name}>{label}</label>}
				{topHint && <small> {topHint}</small>}
			</div>


			<div className={`inner-addon ${hasError && !noAlertIcon ? 'right-addon' : ''}`}>
				{hasError && !noAlertIcon && <i className="ion ion-alert-circled"></i>}
				{children}
				{errorMessage && <span className="help-block"> {errorMessage}</span>}
			</div>
		</div>
	);
};

export default FormControl;

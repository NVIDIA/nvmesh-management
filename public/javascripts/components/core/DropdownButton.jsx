/* global React */

export const DropdownButton = ({
	label,
	disabled,
	children
}) => {
	return (
		<div className="dropdown">
			<button className="btn btn-info mgmt-btn-info multi-select-action-btn dropdown-toggle"
			        data-toggle="dropdown"
			        disabled={disabled}>
				{label}
				<span className="caret"></span>
			</button>
			<ul className="dropdown-menu">
				{children}
			</ul>
		</div>
	);
};

export const DropdownButtonItem = ({
	label,
	disabled,
	onClick
}) => {
	return (
		<li className={`${disabled ? 'disabled' : ''}`}>
			<a disabled={disabled} onClick={onClick}>
				{label}
			</a>
		</li>
	);
};
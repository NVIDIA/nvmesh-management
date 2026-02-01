/* global React */

const { useState } = React;

const AccordionPanel = ({
	title,
	children,
	open,
	header
}) => {
	const [isOpen, setIsOpen] = useState(open);

	const styles = {
		cursor: 'pointer',
		display: 'flex',
		alignItems: 'center'
	};

	const iconStyles = {
		marginRight: '10px',
		...(isOpen ? { transform: 'rotate(-180deg)' } : {}),
		transition: 'transform 0.2s ease-in-out'
	};

	return (
		<>
			<div className="panel-heading" onClick={() => setIsOpen(!isOpen)} style={styles}>
				<i className="fa fa-angle-down" style={iconStyles}></i>
				{title && <h4>{title}</h4>}
				{!title && header}
			</div>
			<div className="panel-body" style={{ ...(!isOpen ? { display: 'none' } : {}) }}>{children}</div>
		</>
	);
};

const Panel = ({
	children,
	style = {},
	className = ''
}) => {

	return (
		<div style={style} className={`panel panel-default ${className}`}>
			{children}
		</div>
	);
};

export { AccordionPanel, Panel };

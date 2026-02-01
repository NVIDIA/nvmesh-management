/* global React */

const { useState, cloneElement } = React;

const OverlayTrigger = ({
	trigger = 'hover',
	overlay,
	children
}) => {
	const [isOverlayVisible, setIsOverlayVisible] = useState(false);

	const events = {};
	if (trigger === 'hover') {
		events.onMouseEnter = () => setIsOverlayVisible(true);
		events.onMouseLeave = () => setIsOverlayVisible(false);
	} else if (trigger === 'click') {
		events.onClick = () => setIsOverlayVisible(!isOverlayVisible);
	}

	return (
		<>
			{React.Children.map(children, child =>
				React.isValidElement(child)
					&& cloneElement(child, {
						...events,
						style: { position: 'relative' },
						children: isOverlayVisible ? overlay : null
					})
			)}
		</>
	);
};

const Popover = ({ children, className = '' }) => {

	return (
		<div className={`popover ${className}`}>
			{children}
		</div>
	);
};

export { OverlayTrigger, Popover };

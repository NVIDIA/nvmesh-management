/* global React */

const { useEffect, useState, cloneElement, useRef } = React;

const Transition = ({
	on,
	children,
	className = '',
	inDelay = 50,
	outDelay = 300,
	inClassName = 'in',
	outClassName = 'out',
	onExited = () => {}
}) => {
	const [visible, setVisible] = useState(false);
	const [isRendered, setIsRendered] = useState(null);
	const prevOn = useRef(on);

	useEffect(() => {
		let timer;

		if (on) {
			setIsRendered(true);
			timer = setTimeout(() => setVisible(true), inDelay);
		} else if (!on && prevOn.current === true) {
			setVisible(false);
			timer = setTimeout(() => setIsRendered(false), outDelay);
		}
		prevOn.current = on;

		return () => clearTimeout(timer);
	}, [on]);

	useEffect(() => {
		if (isRendered === false) {
			onExited();
		}
	}, [isRendered]);

	if (!isRendered) return null;

	return (
		<>
			{React.Children.map(children, child =>
				React.isValidElement(child)
					&& cloneElement(child, {
						className: `${child.props.className || ''} ${className} ${visible ? inClassName : outClassName}`,
					})
			)}
		</>
	);
};

export default Transition;

/* global React */

const { useState, useEffect } = React;

// eslint-disable-next-line no-unused-vars
export const Tab = ({ header, defaultSelectedTab, disabled, onSelect }) => {
	/*	Abstract component, shouldn't be invoked directly, use tabs.*/
};

export const Tabs = ({
	defaultSelectedTab = 0,
	children
}) => {
	const [selectedTab, setSelectedTab] = useState(defaultSelectedTab);

	const tabsArray = React.Children.toArray(children).filter(
		child => React.isValidElement(child) && child.type === Tab
	);

	useEffect(() => {
		if (defaultSelectedTab) {
			setSelectedTab(defaultSelectedTab);
		}
	}, [defaultSelectedTab]);

	return (
		<>
			<ul className="nav nav-tabs">
				{tabsArray.map((child, index) => (
					<TabHeader
						key={index}
						header={child.props.header}
						disabled={child.props.disabled}
						isSelected={index === selectedTab}
						onSelect={() => {
							setSelectedTab(index);
							child.props.onSelect?.();
						}}
					/>
				))}
			</ul>
			{/* Use the selectedTab as key to force remounting when it changes */}
			<TabContent key={selectedTab}>
				{tabsArray[selectedTab] && tabsArray[selectedTab].props.children}
			</TabContent>
		</>
	);
};

const TabHeader = ({ header, isSelected, onSelect, disabled }) => {
	return (
		<li
			className={`${isSelected ? 'active' : ''} ${disabled ? 'disabled' : ''}`}
		>
			<a onClick={() => { !disabled && !isSelected && onSelect(); }}>{header}</a>
		</li>
	);
};

const TabContent = ({ children }) => {
	return (
		<div className="tab-content">
			<div className="tab-pane active">
				<div className="tab-body">
					{children}
				</div>
			</div>
		</div>
	);
};
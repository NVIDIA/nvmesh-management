/* global React */

const { useState } = React;

const ExpandableList = ({
	items = [],
	renderItem = (item, index) => <span key={index}>{item}</span>,
	maxItems = 5,
}) => {
	const [showAll, setShowAll] = useState(false);
	const itemsToRender = showAll ? items : items.slice(0, maxItems);

	return (
		<div className="flex align-center flex-wrap gap-5">
			{itemsToRender.map((item, index) => renderItem(item, index))}
			{items.length > maxItems && <a onClick={() => setShowAll(!showAll)}>{showAll ? 'show less' : `show more (${items.length - maxItems})`}</a>}
		</div>
	);
};

export default ExpandableList;

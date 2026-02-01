/* global React */

const TreeRow = ({ item, columns, onToggle }) => {
	const handleToggle = () => {
		if (item.hasChildren) {
			onToggle(item.nodeId);
		}
	};

	const getIndentStyle = (level) => ({
		width: `${level * 20}px`
	});

	return (
		<tr>
			{columns.map((column, index) => (
				<td key={column.key} className={column.rowClassName}>
					{index === 0 && <div style={{ display: 'flex', alignItems: 'center' }}>
						<span
							className="tree-indent"
							style={getIndentStyle(item.level)}
						/>
						<span
							className={`tree-expander ${item.hasChildren ? 'has-children' : ''} ${item.isExpanded ? 'expanded' : ''}`}
							onClick={handleToggle}
						/>

						<span>{item[column.key]}</span>
					</div>
					}
					{index !== 0 && <span>{item[column.key]}</span>}
				</td>
			)
			)}
		</tr>
	);
};

export default TreeRow;
/* global React */

import TreeRow from './TreeRow.js';

const { useState, useEffect } = React;

const TreeTable = ({ 
	data, 
	columns,
	rowKey = 'id',
	className = '',
	style = {}
}) => {
	const [expandedNodes, setExpandedNodes] = useState(new Set());
	const [flatData, setFlatData] = useState([]);

	const flattenData = (items, level = 0, parentId = null) => {
		const result = [];

		items.forEach(item => {
			const nodeId = `${parentId || 'root'}-${item[rowKey]}`;
			const flatItem = {
				...item,
				level,
				nodeId,
				parentId,
				hasChildren: item.children && item.children.length > 0,
				isExpanded: expandedNodes.has(nodeId)
			};

			result.push(flatItem);

			if (flatItem.hasChildren && flatItem.isExpanded) {
				const childItems = flattenData(item.children, level + 1, nodeId);
				result.push(...childItems);
			}
		});

		return result;
	};

	useEffect(() => {
		setFlatData(flattenData(data));
	}, [data, expandedNodes]);

	const toggleNode = (nodeId) => {
		setExpandedNodes(prev => {
			const newSet = new Set(prev);
			if (newSet.has(nodeId)) {
				newSet.delete(nodeId);
			} else {
				newSet.add(nodeId);
			}
			return newSet;
		});
	};

	return (
		<table className={`table tree-table ${className}`} style={style}>
			<thead>
				<tr>
					{columns.map(column => (
						<th key={column.key} style={column.style} className={column.className}>
							{column.title}
						</th>
					))}
				</tr>
			</thead>
			<tbody>
				{flatData.map(item => (
					<TreeRow
						key={item.nodeId}
						item={item}
						columns={columns}
						onToggle={toggleNode}
					/>
				))}
			</tbody>
		</table>
	);
};

export default TreeTable;
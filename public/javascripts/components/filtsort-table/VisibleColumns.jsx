/* global React */

import Checkbox from '../core/Checkbox.jsx';

const { useState } = React;

const VisibleColumnsTable = ({
	allColumns,
	visibleColumns = [],
	onSelectionChange
}) => {
	const [selectedColumns, setSelectedColumns] = useState(visibleColumns);

	const toggleSelectAll = () => {
		if (selectedColumns.length === 0) {
			setSelectedColumns(allColumns);
			onSelectionChange(allColumns);
		} else {
			setSelectedColumns([]);
			onSelectionChange([]);
		}
	};

	const toggleColumn = (columnName, isSelected) => {
		const updatedSelection = !isSelected
			? selectedColumns.filter((name) => name !== columnName)
			: [...selectedColumns, columnName];

		setSelectedColumns(updatedSelection);
		onSelectionChange(updatedSelection);
	};

	const isAllSelected = selectedColumns.length === allColumns.length;
	const isIndeterminate = selectedColumns.length > 0 && selectedColumns.length < allColumns.length;

	return (
		<div>
			<table className="table table-striped table-hover">
				<thead>
					<tr>
						<th className="fixed-size-column select-column">
							<Checkbox
								id="select-all"
								checked={isAllSelected}
								indeterminate={isIndeterminate}
								onChange={toggleSelectAll}
							/>
						</th>
						<th>Column Name</th>
					</tr>
				</thead>
				<tbody>
					{allColumns.map((column, index) => (
						<tr key={index}>
							<td>
								<Checkbox
									id={`check-${column}`}
									checked={selectedColumns.includes(column)}
									onChange={e => toggleColumn(column, e.target.checked)}
								/>
							</td>
							<td>{column}</td>
						</tr>
					))}
				</tbody>
			</table>
		</div>
	);
};

export default VisibleColumnsTable;

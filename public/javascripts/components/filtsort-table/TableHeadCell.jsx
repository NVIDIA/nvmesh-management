/* global React */

export const TableHeadCell = ({ col }) => {
	const attributes = {
		...(col.sortable !== false && { 'data-sortable': '' }),
		...(col.filterable !== false && { 'data-filterable': '' }),
		...(col.draggable !== false && { 'draggable': true }),
		...(!!col.type && { 'data-type': col.type }),
		...(!!col.sort && { 'data-direction': col.sort }),
		...(!!col.placeholder && { 'data-placeholder': col.placeholder }),
		...(!!col.type && { 'filter-id': col.field }),
		...(!!col.choice && { 'data-choice': col.choice }),
		...(!!col.choices && { 'data-choices': col.choices }),
		...(!!col.customDataFilter && { 'custom-data-filter': col.customDataFilter }),
		...(!!col.customDataSortField && { 'custom-data-sort-field': col.customDataSortField }),
	};

	return (
		<th
			column-name={col.name}
			className={col.className}
			data-field={col.field}
			{...attributes}
		>
			{col.title != null ? col.title : col.name}
		</th>
	);
};
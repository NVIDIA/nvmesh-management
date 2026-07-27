/* global React */

import FiltSortTable from '../../filtsort-table/FiltSortTable.jsx';
import { KeysService } from '../../services/api/keys.service.js';

const { forwardRef } = React;

const KeysFiltSortTable = forwardRef(function KeysFiltSortTable({
	tableId,
	onEditKey = () => {},
	...props
}, ref) {
	const columns = [
		{
			name: 'Name',
			field: '_id',
			placeholder: 'Search by Name',
			className: 'fixed-size-column md-column',
		},
		{
			name: 'Description',
			field: 'description',
			placeholder: 'Search by Description',
		},
		{
			name: 'Last Modified By',
			field: 'modifiedBy',
			placeholder: 'Search by Last Modifier',
			className: 'fixed-size-column md-column',
		},
		{
			name: 'Date Modified',
			field: 'dateModified',
			placeholder: 'Search by Date Modified',
			type: 'dateRange',
			className: 'fixed-size-column md-column',
		},
		{
			name: 'Actions',
			title: '',
			filterable: false,
			sortable: false,
			draggable: false,
			className: 'fixed-size-column action-column',
			rowClassName: 'fixed-size-column',
			value: (row) => (
				<a className="fa fa-pencil edit-button" onClick={() => onEditKey(row)}></a>
			),
		},
	];

	return (
		<FiltSortTable
			{...props}
			ref={ref}
			tableId={tableId}
			columns={columns}
			loadTotal={KeysService.loadTotal}
			loadRows={KeysService.loadKeys}
		/>
	);
});

export default KeysFiltSortTable;
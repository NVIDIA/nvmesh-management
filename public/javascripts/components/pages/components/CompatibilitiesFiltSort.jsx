/* global React */

import FiltSortTable from '../../filtsort-table/FiltSortTable.jsx';
import { ComponentsService } from '../../services/api/components.service.js';

const CompatibilitiesFiltSort = ({ tableRef, ...props }) => {
	const columns = [
		{
			name: 'Type',
			field: 'component.componentType.name',
			placeholder: 'Search by Type',
			className: 'fixed-size-column md-column',
			value: row => <span>{row.component.componentType.name}</span>
		},
		{
			name: 'Component',
			field: 'component.name',
			placeholder: 'Search by Component',
			className: 'fixed-size-column',
			value: row => <span>{row.component.name}</span>
		},
		{
			name: 'Version',
			field: 'componentVersion.version',
			placeholder: 'Search by Version',
			className: 'fixed-size-column md-column',
			rowClassName: 'wrap fixed-size-column',
			value: row => <span>{row.version}</span>
		}
	];

	const loadRows = async(filter, sort, currentPage, count) => {
		const components = await ComponentsService.loadComponentVersions(filter, sort, currentPage, count, true);

		return components;
	};

	return (
		<FiltSortTable
			{...props}
			tableRef={tableRef}
			columns={columns}
			loadTotal={ComponentsService.loadTotal}
			loadRows={loadRows}
			rowIdentifier="ID"
		/>
	);
};

export default CompatibilitiesFiltSort;
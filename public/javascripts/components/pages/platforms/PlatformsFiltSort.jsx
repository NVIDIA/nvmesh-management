/* global React */

import FiltSortTable from '../../filtsort-table/FiltSortTable.jsx';
import { PlatformsService } from '../../services/api/platforms.service.js';
import { events, SocketService } from '../../services/socket.service.js';

const PlatformsFiltSort = ({
	editPlatform,
	tableRef,
	...props
}) => {
	const columns = [
		{
			name: 'Name',
			field: 'platform.name',
			placeholder: 'Search by Name',
			className: 'fixed-size-column md-column',
			value: row => <strong>{row.name}</strong>
		},
		{
			name: 'Description',
			field: 'description',
			placeholder: 'Search by Description',
			className: 'fixed-size-column'
		},
		{
			name: 'Arch',
			field: 'archType.name',
			placeholder: 'Search by Architecture',
			className: 'fixed-size-column md-column',
			rowClassName: 'wrap fixed-size-column',
			value: row => <span>{row.archType.name}</span>
		},
		{
			name: 'Operating System',
			field: 'operatingSystem.version',
			placeholder: 'Search by Operating System',
			className: 'fixed-size-column md-column',
			rowClassName: 'fixed-size-column',
			value: row => <span>{`${row.operatingSystem.distributionType.name} ${row.operatingSystem.version}`}</span>
		},
		{
			name: 'Kernel',
			field: 'kernel.version',
			placeholder: 'Search by Kernel',
			className: 'fixed-size-column xl-column',
			rowClassName: 'fixed-size-column',
			value: row => <span>{row.kernel.version}</span>
		},
		{
			name: 'Ofed',
			field: 'ofed.version',
			placeholder: 'Search by Ofed',
			className: 'fixed-size-column sx-column',
			rowClassName: 'fixed-size-column',
			value: row => <span>{row.ofed.version}</span>
		}
	];

	if (editPlatform)
		columns.push({
			name: 'Actions',
			title: '',
			filterable: false,
			sortable: false,
			draggable: false,
			className: 'fixed-size-column action-column',
			rowClassName: 'fixed-size-column',
			value: (row) => (
				<a className="fa fa-pencil edit-button" onClick={() => editPlatform(row)}></a>
			),
		});

	const reloadTable = () => {
		if (tableRef.current) {
			tableRef.current.reloadRows();
			tableRef.current.reloadTotal();
		}
	};

	const loadRows = async(filter, sort, currentPage, count) => {
		const platforms = await PlatformsService.loadPlatforms(filter, sort, currentPage, count);
		platforms.forEach(platform => {
			SocketService.addHandler(SocketService.getPlatformID(platform.ID) + events.platformChangedEvent.name, () => reloadTable());
			SocketService.addHandler(SocketService.getPlatformID(platform.ID) + events.platformRemovedEvent.name, () => reloadTable());
		});
		return platforms;
	};

	return (
		<FiltSortTable
			{...props}
			ref={tableRef}
			columns={columns}
			loadTotal={PlatformsService.loadTotal}
			loadRows={loadRows}
			rowIdentifier="ID"
		/>
	);
};

export default PlatformsFiltSort;
/* global React */

import FiltSortTable from '../../filtsort-table/FiltSortTable.jsx';
import { KernelsService } from '../../services/api/kernels.service.js';
import { events, SocketService } from '../../services/socket.service.js';

const { forwardRef, useEffect } = React;

const KernelsFiltSortTable = forwardRef(function KernelsFiltSortTable({
	tableId,
	onEditKernel = () => {},
	...props
}, ref) {
	useEffect(() => {
		SocketService.addHandler(events.newKernelEvent.name, () => reloadTable());
		SocketService.addHandler(events.kernelRemovedEvent.name, () => reloadTable());
	}, []);

	const reloadTable = () => {
		if (ref.current) {
			ref.current.reloadRows();
			ref.current.reloadTotal();
		}
	};

	const columns = [
		{
			name: 'Version',
			field: 'version',
			placeholder: 'Search by Version',
			className: 'fixed-size-column',
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
				<a className="fa fa-pencil edit-button" onClick={() => onEditKernel(row)}></a>
			),
		},
	];

	const loadRows = async(filter, sort, currentPage, count) => {
		const kernels = await KernelsService.loadKernels(filter, sort, currentPage, count);
		kernels.forEach(kernel => {
			const kernelEventName = SocketService.getKernelID(kernel.ID) + events.kernelChangedEvent.name;
			SocketService.addHandler(kernelEventName, ({ payload }) => {
				if (ref.current) {
					ref.current.updateRow(kernel.ID, Object.assign(kernel, payload));
				}
			});
		});
		return kernels;
	};

	return (
		<FiltSortTable
			{...props}
			ref={ref}
			tableId={tableId}
			rowIdentifier="ID"
			columns={columns}
			loadTotal={KernelsService.loadTotal}
			loadRows={loadRows}
		/>
	);
});

export default KernelsFiltSortTable;
/*
 * SPDX-FileCopyrightText: Copyright (c) 2026 NVIDIA CORPORATION & AFFILIATES. All rights reserved.
 * SPDX-License-Identifier: Apache-2.0
 */

/* global React */

import FiltSortTable from '../../filtsort-table/FiltSortTable.jsx';
import { OperatingSystemsService } from '../../services/api/operatingSystems.service.js';
import { events, SocketService } from '../../services/socket.service.js';

const { forwardRef, useEffect } = React;

const OperatingSystemsFiltSortTable = forwardRef(function OperatingSystemsFiltSortTable({
	tableId,
	onEditOperatingSystem = () => {},
	...props
}, ref) {
	useEffect(() => {
		SocketService.addHandler(events.newOperatingSystemEvent.name, () => reloadTable());
		SocketService.addHandler(events.operatingSystemRemovedEvent.name, () => reloadTable());
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
			className: 'fixed-size-column md-column',
		},
		{
			name: 'Distribution Type',
			field: 'distributionType',
			placeholder: 'Search by Distribution Type',
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
				<a className="fa fa-pencil edit-button" onClick={() => onEditOperatingSystem(row)}></a>
			),
		},
	];

	const loadRows = async(filter, sort, currentPage, count) => {
		const operatingSystems = await OperatingSystemsService.loadOperatingSystems(filter, sort, currentPage, count);
		operatingSystems.forEach(operatingSystem => {
			const operatingSystemEventName = SocketService.getOperatingSystemID(operatingSystem.ID) + events.operatingSystemChangedEvent.name;
			SocketService.addHandler(operatingSystemEventName, ({ payload }) => {
				if (ref.current) {
					ref.current.updateRow(operatingSystem.ID, Object.assign(operatingSystem, payload));
				}
			});
		});
		return operatingSystems;
	};

	return (
		<FiltSortTable
			{...props}
			ref={ref}
			tableId={tableId}
			rowIdentifier="ID"
			columns={columns}
			loadTotal={OperatingSystemsService.loadTotal}
			loadRows={loadRows}
		/>
	);
});

export default OperatingSystemsFiltSortTable;
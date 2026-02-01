/*
 * SPDX-FileCopyrightText: Copyright (c) 2026 NVIDIA CORPORATION & AFFILIATES. All rights reserved.
 * SPDX-License-Identifier: Apache-2.0
 */

/* global React */

import FiltSortTable from '../../filtsort-table/FiltSortTable.jsx';
import { OfedsService } from '../../services/api/ofeds.service.js';
import { events, SocketService } from '../../services/socket.service.js';

const { forwardRef, useEffect } = React;

const OfedsFiltSortTable = forwardRef(function OfedsFiltSortTable({
	tableId,
	onEditOfed = () => {},
	...props
}, ref) {
	useEffect(() => {
		SocketService.addHandler(events.newOfedEvent.name, () => reloadTable());
		SocketService.addHandler(events.ofedRemovedEvent.name, () => reloadTable());
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
				<a className="fa fa-pencil edit-button" onClick={() => onEditOfed(row)}></a>
			),
		},
	];

	const loadRows = async(filter, sort, currentPage, count) => {
		const ofeds = await OfedsService.loadOfeds(filter, sort, currentPage, count);
		ofeds.forEach(ofed => {
			const ofedEventName = SocketService.getOfedID(ofed.ID) + events.ofedChangedEvent.name;
			SocketService.addHandler(ofedEventName, ({ payload }) => {
				if (ref.current) {
					ref.current.updateRow(ofed.ID, Object.assign(ofed, payload));
				}
			});
		});
		return ofeds;
	};

	return (
		<FiltSortTable
			{...props}
			ref={ref}
			tableId={tableId}
			rowIdentifier="ID"
			columns={columns}
			loadTotal={OfedsService.loadTotal}
			loadRows={loadRows}
		/>
	);
});

export default OfedsFiltSortTable;
/*
 * SPDX-FileCopyrightText: Copyright (c) 2026 NVIDIA CORPORATION & AFFILIATES. All rights reserved.
 * SPDX-License-Identifier: Apache-2.0
 */

/* global React */

import FiltSortTable from '../filtsort-table/FiltSortTable.jsx';
import { BackupsService } from '../services/api/backups.service.js';
import { useAppContext } from './App.jsx';
import CapacityService from '../services/capacity.service.js';
import { SocketService, events } from '../services/socket.service.js';

const { useRef, useEffect } = React;

const Backups = () => {
	const { unitType } = useAppContext();
	const tableRef = useRef();

	useEffect(() => {
		SocketService.addHandler(events.backupChangeEvent.name, () => {
			if (tableRef.current) {
				tableRef.current.reloadRows();
				tableRef.current.reloadTotal();
			}
		});
	}, []);

	const columns = [
		{
			name: 'Backup ID',
			field: 'backup_id',
			placeholder: 'Search by Backup ID'
		},
		{
			name: 'Date',
			field: 'dateCreated',
			type: 'dateRange',
			className: 'fixed-size-column md-column',
			rowClassName: 'fixed-size-column',
			sort: 'desc'
		},
		{
			name: 'Size',
			field: 'size',
			filterable: false,
			className: 'fixed-size-column sx-column',
			rowClassName: 'fixed-size-column',
			value: backup => CapacityService.toBiggestUnit(backup.size, unitType, { fromBytes: true })
		},
		{
			name: 'Type',
			field: 'type',
			placeholder: 'Search by Type',
			className: 'fixed-size-column md-column',
			rowClassName: 'fixed-size-column',
		}
	];

	return (
		<div className="page-content">
			<h1>Backups</h1>

			<FiltSortTable
				ref={tableRef}
				tableId="backups"
				columns={columns}
				loadTotal={BackupsService.loadTotal}
				loadRows={BackupsService.loadBackups}
			/>
		</div>
	);
};

export default Backups;

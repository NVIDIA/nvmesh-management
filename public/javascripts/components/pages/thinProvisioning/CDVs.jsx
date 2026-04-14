/*
 * SPDX-FileCopyrightText: Copyright (c) 2026 NVIDIA CORPORATION & AFFILIATES. All rights reserved.
 * SPDX-License-Identifier: Apache-2.0
 */

/* global React, consts */

import FiltSortTable from '../../filtsort-table/FiltSortTable.jsx';
import { useAlerts } from '../../core/Alert.jsx';
import { VolumesService } from '../../services/api/volumes.service.js';
import { useAppContext } from '../../App.jsx';
import CapacityService from '../../services/capacity.service.js';
import { events, SocketService } from '../../services/socket.service.js';

const { useRef, useEffect } = React;

const CDV_FILTER = { volumeClass: consts.volumeClass.CDV };

const loadRows = async(filter, sort, currentPage, count) => {
	return VolumesService.loadVolumes({ ...filter, ...CDV_FILTER }, sort, currentPage, count);
};

const loadTotal = async(filter) => VolumesService.loadTotal({ ...filter, ...CDV_FILTER });

const CDVs = () => {
	const { unitType } = useAppContext();
	const { errorAlert } = useAlerts();
	const tableRef = useRef();

	useEffect(() => {
		const interval = setInterval(() => reloadTable(false), 3000);
		return () => clearInterval(interval);
	}, []);

	useEffect(() => {
		SocketService.addHandler(events.newVolumeEvent.name, () => reloadTable());
	}, []);

	const reloadTable = (deselectMissingRows = true) => {
		if (tableRef.current) {
			tableRef.current.reloadRows(deselectMissingRows);
			tableRef.current.reloadTotal();
		}
	};

	const columns = [
		{
			name: 'Name',
			field: 'name',
			placeholder: 'Search by Name',
			sort: 'asc',
		},
		{
			name: 'Capacity',
			field: 'capacity',
			filterable: false,
			className: 'fixed-size-column sx-column',
			rowClassName: 'fixed-size-column',
			value: cdv => CapacityService.toBiggestUnit(cdv.capacity, unitType),
		},
		{
			name: 'TPVs',
			field: 'tpvCount',
			filterable: false,
			className: 'fixed-size-column sx-column',
			rowClassName: 'fixed-size-column',
			value: cdv => cdv.cdvConfig
				? `${cdv.tpvCount || 0} / ${cdv.cdvConfig.maxTPVs}`
				: '—',
		},
		{
			name: 'Extent Size',
			field: 'cdvConfig.cdvExtentSizeMB',
			filterable: false,
			className: 'fixed-size-column sx-column',
			rowClassName: 'fixed-size-column',
			value: cdv => cdv.cdvConfig?.cdvExtentSizeMB != null
				? `${cdv.cdvConfig.cdvExtentSizeMB} MB`
				: '—',
		},
		{
			name: 'Status',
			field: 'status',
			className: 'fixed-size-column sx-column',
			rowClassName: 'fixed-size-column',
			value: cdv => <label className={`label bg-${cdv.status === consts.volumeStatuses.ONLINE ? 'green' : 'gray'}`}>
				{cdv.status || '—'}
			</label>,
		},
	];

	return (
		<div className="page-content">
			<h1>CDVs</h1>

			<FiltSortTable
				ref={tableRef}
				tableId="cdvs"
				columns={columns}
				loadTotal={loadTotal}
				loadRows={loadRows}
			/>
		</div>
	);
};

export default CDVs;

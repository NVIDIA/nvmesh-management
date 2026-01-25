/*
 * SPDX-FileCopyrightText: Copyright (c) 2026 NVIDIA CORPORATION & AFFILIATES. All rights reserved.
 * SPDX-License-Identifier: Apache-2.0
 */

/* global React, consts, moment */

import FiltSortTable from '../filtsort-table/FiltSortTable.jsx';
import { ManagementClusterService } from '../services/api/management-cluster.service.js';
import { events, SocketService } from '../services/socket.service.js';
import { extractResults } from '../utils.js';
import { useAlerts } from '../core/Alert.jsx';
import { useConfirmationDialog } from '../shared/ConfirmationDialog.jsx';
import ManagementID from '../shared/ManagementID.jsx';

const { useState, useEffect, useRef } = React;

const getHealthIcon = (socketStatus) => {
	switch (socketStatus) {
		case consts.socketStatus.CONNECTED:
			return <i className="ion-checkmark-circled green table-icon" title={socketStatus}></i>;
		case consts.socketStatus.CONNECTING:
			return <i className="fa fa-cog fa-spin table-icon" title={socketStatus}></i>;
		case consts.socketStatus.DISCONNECTED:
			return <i className="fa fa-exclamation-circle red table-icon" title={socketStatus}></i>;
		default:
			return null;
	}
};

const isActive = (mgmt) => {
	if (mgmt.isMe)
		return true;

	const now = moment();
	const lastModified = moment(mgmt.dateModified);
	let minutesSinceLastReport = now.diff(lastModified, 'minutes');
	return minutesSinceLastReport < 5;
};

const getInactiveMgmtIcon = (row) => {
	const tooltipText = 'Management did not report to the DB in the last 5 Minutes';
	if (!isActive(row))
		return <i className="fa fa-exclamation-circle red table-icon" marginRight="5px" title={tooltipText}></i>;
	else
		return;
};

const ManagementCluster = () => {
	const tableRef = useRef();
	const { successAlert, errorAlert } = useAlerts();
	const [confirm] = useConfirmationDialog();
	const [selected, setSelected] = useState([]);

	useEffect(() => {
		const interval = setInterval(() => reloadTable(false), 5000);

		SocketService.addHandler(events.newManagementInClusterEvent.name, () => {
			reloadTable(false);
		});
		return () => {
			clearInterval(interval);
		};
	}, []);

	const reloadTable = (deselectMissingRows = true) => {
		if (tableRef.current) {
			tableRef.current.reloadRows(deselectMissingRows);
			tableRef.current.reloadTotal();
		}
	};

	const columns = [
		{
			name: 'Management ID',
			field: '_id',
			sortable: true,
			filterable: true,
			placeholder: 'Search by Management ID',
			sort: 'desc',
			value: (row) => (
				<><ManagementID id={row._id}/> <span>{getInactiveMgmtIcon(row)}</span></>
			),
		},
		{
			name: 'Hostname',
			field: 'hostname',
			sortable: true,
			filterable: true,
			placeholder: 'Search by hostname',
			sort: 'desc',
		},
		{
			name: 'IP',
			field: 'ip',
			sortable: true,
			filterable: true
		},
		{
			name: 'Use SSL',
			field: 'useSSL',
			filterable: false,
			value: row => row.useSSL.toString()
		},
		{
			name: 'Port',
			field: 'port',
			filterable: false,
		},
		{
			name: 'Version',
			field: 'managementVersion',
			filterable: false,
		},
		{
			name: 'Date Modified',
			field: 'dateModified',
			sortable: true,
			filterable: true,
			type: 'dateRange',
		},
		{
			name: 'Outbound Socket',
			field: 'outbound_socket_status',
			filterable: false,
			rowClassName: 'fixed-size-column',
			value: (row) =>
				!row.isMe ? getHealthIcon(row.outbound_socket_status) : '-',
		},
		{
			name: 'Inbound Socket',
			field: 'inbound_socket_status',
			filterable: false,
			rowClassName: 'fixed-size-column',
			value: (row) =>
				!row.isMe ? getHealthIcon(row.inbound_socket_status) : '-',
		},
	];

	const deleteMgmts = async() => {
		const confirmed = await confirm(`Are you sure you want to delete ${selected.length} Management(s)?`);
		if (!confirmed) {
			return;
		}

		const payload = selected.map(mgmt => mgmt._id);

		const responses = await ManagementClusterService.delete(payload);
		const responsesBySuccess = extractResults(responses);

		if (responsesBySuccess.success.length) {
			successAlert(`${responsesBySuccess.success.length} Management(s) deleted successfully`);
			reloadTable();
		}
		Object.keys(responsesBySuccess.failed).forEach(errorMsg => {
			const ids = responsesBySuccess.failed[errorMsg].map(entity => entity._id).join(', ');
			errorAlert(`Failed to delete Management(s) ${ids} - ${errorMsg}`);
		});
	};

	return (
		<div className="page-content">
			<h1>Management Cluster</h1>

			<div className="action-container">
				<button className="btn multi-select-action-btn btn-info mgmt-btn-info"
				        disabled={!selected.length || selected.some(mgmt => mgmt.isMe)}
				        onClick={() => deleteMgmts()}>
					Delete
				</button>
			</div>

			<FiltSortTable
				ref={tableRef}
				tableId="managementCluster"
				columns={columns}
				loadTotal={ManagementClusterService.loadTotal}
				loadRows={ManagementClusterService.loadCluster}
				multiselectOptions={{
					enabled: true,
					onSelectedRowsChange: selectedRows => {
						setSelected(selectedRows);
					}
				}}
			/>
		</div>
	);
};

export default ManagementCluster;

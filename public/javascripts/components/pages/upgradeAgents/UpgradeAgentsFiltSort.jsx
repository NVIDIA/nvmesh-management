/*
 * SPDX-FileCopyrightText: Copyright (c) 2026 NVIDIA CORPORATION & AFFILIATES. All rights reserved.
 * SPDX-License-Identifier: Apache-2.0
 */

/* global React, consts, moment */

import FiltSortTable from '../../filtsort-table/FiltSortTable.jsx';
import { UpgradeAgentsService } from '../../services/api/upgradeAgents.service.js';
import { events, SocketService } from '../../services/socket.service.js';
import { extractErrorMsg } from '../../utils.js';
import { useAlerts } from '../../core/Alert.jsx';

const { useEffect } = React;

const healthToIcon = {
	[consts.upgradeAgentHealth.HEALTHY]: 'ion-checkmark-circled green',
	[consts.upgradeAgentHealth.CRITICAL]: 'fa fa-exclamation-circle red'
};

const getUpgradeAgentHealthMessage = (upgradeAgent) => {
	if (!upgradeAgent.upgradeAgentData || upgradeAgent.upgradeAgentData.health === consts.upgradeAgentHealth.CRITICAL) {
		let msg = 'Upgrade Agent needs manual intervention';
		if (upgradeAgent.upgradeAgentData.healthError) {
			msg += `: ${upgradeAgent.upgradeAgentData.healthError}`;
		}
		return msg;
	}

	if (!upgradeAgent.lastReceivedKeepAlive || upgradeAgent.status === consts.upgradeAgentStatus.OFFLINE) {
		return 'Critical';
	}

	return 'Healthy';
};

const STALE_KEEPALIVE_THRESHOLD_IN_MINUTES = 10;

// eslint-disable-next-line react/display-name
const UpgradeAgentsFiltSort = React.forwardRef(({
	onSelectedRowsChange,
	...props
}, ref) => {
	const { errorAlert } = useAlerts();
	
	useEffect(() => {
		SocketService.addHandler(events.newUpgradeAgentEvent.name, () => reloadTable());
		SocketService.addHandler(events.upgradeAgentRemovedEvent.name, () => reloadTable());
	}, []);

	const reloadTable = () => {
		if (ref.current) {
			ref.current.reloadRows();
			ref.current.reloadTotal();
		}
	};

	const dataColumns = [
		{
			name: 'Operating System',
			field: 'upgradeAgentData.operatingSystem.name',
		},
		{
			name: 'Kernel',
			field: 'upgradeAgentData.kernel'
		},
		{
			name: 'Architecture',
			field: 'upgradeAgentData.archType'
		},
		{
			name: 'Ofed',
			field: 'upgradeAgentData.ofed'
		},
		{
			name: 'NVMesh Client Version',
			field: 'upgradeAgentData.nvmeshVersions.nvmesh-client',
		},
		{
			name: 'NVMesh Target Version',
			field: 'upgradeAgentData.nvmeshVersions.nvmesh-target',
		},
		{
			name: 'NVMesh Management Version',
			field: 'upgradeAgentData.nvmeshVersions.nvmesh-management',
		},
		{
			name: 'Upgrade Agent Version',
			field: 'upgradeAgentData.version'
		},
	];

	const columns = [
		{
			name: 'Hostname',
			field: 'hostname',
			placeholder: 'Search by Hostname',
			className: 'fixed-size-column',
			value: row => <strong>{row.hostname}</strong>
		},
		...dataColumns.map(col => ({
			...col,
			placeholder: col.filterable !== false && `Search by ${col.name}`,
			className: 'fixed-size-column',
			rowClassName: 'fixed-size-column'
		})),
		{
			name: 'Date Modified',
			field: 'dateModified',
			type: 'dateRange',
			placeholder: 'Search by Date Modified',
			className: 'fixed-size-column lg-column',
			rowClassName: 'fixed-size-column',
			value: row => <>
				{row.dateModified && (moment().diff(moment(row.dateModified), 'minutes') > STALE_KEEPALIVE_THRESHOLD_IN_MINUTES) && (
					<i className="fa fa-exclamation-circle mr-5" title={`Last Keepalive over ${STALE_KEEPALIVE_THRESHOLD_IN_MINUTES} minutes ago`}></i>
				)}
				<span className="mr-5">{row.dateModified && moment(row.dateModified).format('MM/DD/YYYY H:mm:ss')}</span>
				<a className="fa fa-refresh"
				   onClick={() => requestFreshKeepalive(row)}
				   title="Request Fresh Keepalive"></a>
			</>
		},
		{
			name: 'Health',
			field: 'health',
			type: 'choice',
			choices: Object.values(consts.upgradeAgentHealth),
			className: 'fixed-size-column sx-column',
			rowClassName: 'fixed-size-column table-icon',
			value: upgradeAgent => {
				const healthMessage = getUpgradeAgentHealthMessage(upgradeAgent);
				return <i className={`${healthToIcon[upgradeAgent.health]}`} title={healthMessage}/>;
			}
		},
	];

	const requestFreshKeepalive = async(upgradeAgent) => {
		const response = await UpgradeAgentsService.requestFreshKeepalive(upgradeAgent._id);
		if (!response.success) {
			const errorMsg = extractErrorMsg(response.error);
			errorAlert(`Failed to request Keepalive for ${upgradeAgent._id} - ${errorMsg}`);
		}
	};

	const loadRows = async(filter, sort, currentPage, count) => {
		const upgradeAgents = await UpgradeAgentsService.loadUpgradeAgents(filter, sort, currentPage, count);
		upgradeAgents.forEach(upgradeAgent => {
			const upgradeAgentEventName = SocketService.getUpgradeAgentID(upgradeAgent._id) + events.upgradeAgentChangedEvent.name;
			SocketService.addHandler(upgradeAgentEventName, ({ payload }) => {
				if (ref.current) {
					ref.current.updateRow(upgradeAgent._id, Object.assign(upgradeAgent, payload));
				}
			});
		});
		return upgradeAgents;
	};

	return (
		<FiltSortTable
			{...props}
			ref={ref}
			columns={columns}
			loadTotal={UpgradeAgentsService.loadTotal}
			loadRows={loadRows}
			multiselectOptions={{
				enabled: true,
				onSelectedRowsChange: onSelectedRowsChange
			}}
		/>
	);
});

export default UpgradeAgentsFiltSort;
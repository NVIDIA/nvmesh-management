/*
 * SPDX-FileCopyrightText: Copyright (c) 2026 NVIDIA CORPORATION & AFFILIATES. All rights reserved.
 * SPDX-License-Identifier: Apache-2.0
 */

/* global React */

import { useAlerts } from '../../core/Alert.jsx';
import FiltSortTable from '../../filtsort-table/FiltSortTable.jsx';
import { ClientsService } from '../../services/api/clients.service.js';
import { ConfigurationProfilesService } from '../../services/api/configuration-profiles.service.js';
import ConfigProfileView from './ConfigProfileView.jsx';

const { useRef } = React;

const MultiSelectProfileNodes = ({
	initialSelectedNodes,
	onChange = () => {}
}) => {
	const tableRef = useRef();
	const { errorAlert } = useAlerts();

	const initialSelectedNodesSet = new Set(initialSelectedNodes.map(row => row._id));

	const columns = [
		{
			name: 'Node ID',
			field: '_id',
			placeholder: 'Search by Node ID',
		},
		{
			name: 'Assigned Profile',
			field: 'desiredProfile.name',
			value: row => <ConfigProfileView configProfile={row.desiredProfile} />,
			className: 'fixed-size-column md-column',
			rowClassName: 'fixed-size-column lg-column',
		},
		{
			name: 'Reported Profile',
			field: 'reportedProfile',
			sortable: false,
			filterable: false,
			value: row => <ConfigProfileView configProfile={row.reportedProfile} restartRequired={row.restartRequired} />,
			className: 'fixed-size-column md-column',
			rowClassName: 'fixed-size-column lg-column',
		},
		{
			name: 'Version',
			field: 'version',
			sortabel: false,
			filterable: false,
			placeholder: 'Search by Version',
			className: 'fixed-size-column md-column',
			rowClassName: 'fixed-size-column',
		}
	];

	/* gets the nodeConfig and adds the report client profile */
	const getRows = async(filter, sort, currentPage, count) => {
		let res = await ConfigurationProfilesService.getNodesConfigs(filter, sort, currentPage, count);
		if (res.error) {
			errorAlert(`Failed to fetch nodeConfigs - Err: ${JSON.stringify(res.error.err || {})}`);
			return [];
		}

		const rows = res;
		let clientsFilter = { _id: { $in: rows.map(r=>r._id) } };
		let clientProjection = { configProfile: 1, restartRequired: 1, version: 1 };
		let clients = await ClientsService.loadAll(clientsFilter, clientProjection);

		// build clients dict
		let clientsDict = {};
		clients.forEach(c => clientsDict[c._id] = c);

		// add client fields to nodeConfig row
		rows.forEach(row => {
			row.reportedProfile = clientsDict[row._id].configProfile;
			row.restartRequired = clientsDict[row._id].restartRequired;
			row.version = clientsDict[row._id].version;
		});

		return rows;
	};

	const disabledRowIfWasAlreadyAssigned = (row) => {
		return initialSelectedNodesSet.has(row._id);
	};

	return (
		<div>
			<FiltSortTable
				tableId="node-configs-multi-select"
				ref={tableRef}
				columns={columns}
				loadRows={getRows}
				loadTotal={ConfigurationProfilesService.getNodesConfigsTotal}
				queryParamsEnabled={false}
				rowIdentifier="_id"
				multiselectOptions={{
					enabled: true,
					initiallySelectedRows: initialSelectedNodes,
					rowSelectionDisabled: disabledRowIfWasAlreadyAssigned,
					onSelectedRowsChange: selectedRows => onChange(selectedRows)
				}}
			/>
		</div>
	);
};

export default MultiSelectProfileNodes;
/*
 * SPDX-FileCopyrightText: Copyright (c) 2026 NVIDIA CORPORATION & AFFILIATES. All rights reserved.
 * SPDX-License-Identifier: Apache-2.0
 */

/* global React */

import FiltSortTable from '../filtsort-table/FiltSortTable.jsx';
import { ClientsService } from '../services/api/clients.service.js';
import { getConfigProfileVersion } from '../utils.js';

const { useRef } = React;

const MultiSelectClients = ({
	initialSelectedClients,
	// eslint-disable-next-line no-unused-vars
	onChange = _ => {}
}) => {
	const tableRef = useRef();

	const columns = [
		{
			name: 'Client ID',
			field: 'clientID',
			placeholder: 'Search by Client ID',
		},
		{
			name: 'Profile Version',
			field: 'configProfile',
			value: client => <span title={getConfigProfileVersion(client.configProfile)}>{getConfigProfileVersion(client.configProfile, true)}</span>,
			className: 'fixed-size-column md-column',
			rowClassName: 'fixed-size-column lg-column',
		},
		{
			name: 'Version',
			field: 'version',
			placeholder: 'Search by Version',
			className: 'fixed-size-column md-column',
			rowClassName: 'fixed-size-column',
		}
	];

	return (
		<div>
			<FiltSortTable
				tableId="clients-multi-select"
				ref={tableRef}
				columns={columns}
				loadRows={ClientsService.loadClients}
				loadTotal={ClientsService.loadTotal}
				queryParamsEnabled={false}
				rowIdentifier="clientID"
				multiselectOptions={{
					enabled: true,
					initiallySelectedRows: initialSelectedClients,
					onSelectedRowsChange: selectedRows => onChange(selectedRows.map(row => row.clientID))
				}}
			/>
		</div>
	);
};

export default MultiSelectClients; 
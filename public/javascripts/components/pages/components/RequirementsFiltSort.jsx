/*
 * SPDX-FileCopyrightText: Copyright (c) 2026 NVIDIA CORPORATION & AFFILIATES. All rights reserved.
 * SPDX-License-Identifier: Apache-2.0
 */

/* global React */

import FiltSortTable from '../../filtsort-table/FiltSortTable.jsx';
import { ComponentsService } from '../../services/api/components.service.js';

const RequirementsFiltSort = ({ tableRef, ...props }) => {
	const columns = [
		{
			name: 'Type',
			field: 'componentType.name',
			placeholder: 'Search by Type',
			className: 'fixed-size-column md-column',
			value: row => <span>{row.componentType.name}</span>
		},
		{
			name: 'Component',
			field: 'component.name',
			placeholder: 'Search by Component',
			className: 'fixed-size-column',
			value: row => <span>{row.name}</span>
		}
	];

	const loadRows = async(filter, sort, currentPage, count) => {
		const components = await ComponentsService.loadComponents(filter, sort, currentPage, count, true);

		return components;
	};

	return (
		<FiltSortTable
			{...props}
			tableRef={tableRef}
			columns={columns}
			loadTotal={ComponentsService.countComponents}
			loadRows={loadRows}
			rowIdentifier="ID"
		/>
	);
};

export default RequirementsFiltSort;

/*
 * SPDX-FileCopyrightText: Copyright (c) 2026 NVIDIA CORPORATION & AFFILIATES. All rights reserved.
 * SPDX-License-Identifier: Apache-2.0
 */

/* global React, INTERVALS */

import FiltSortTable from '../../filtsort-table/FiltSortTable.jsx';
import { useAlerts } from '../../core/Alert.jsx';
import { useConfirmationDialog } from '../../shared/ConfirmationDialog.jsx';
import { VolumeProvisioningGroupsService } from '../../services/api/volumeProvisioningGroups.service.js';
import { extractErrorMsg, extractResults } from '../../utils.js';
import NewButton from '../../shared/NewButton.jsx';
import CreateEditVPGModal from './CreateEditVPGModal.jsx';
import { useAppContext } from '../App.jsx';
import CapacityService from '../../services/capacity.service.js';

const { useRef, useState, useEffect, useMemo } = React;

const VolumeProvisioningGroups = () => {
	const { unitType } = useAppContext();
	const { successAlert, errorAlert } = useAlerts();
	const [confirm] = useConfirmationDialog();
	const [selectedVPGs, setSelectedVPGs] = useState([]);
	const [showCreateEditModal, setShowCreateEditModal] = useState(false);
	const [vpg, setVPG] = useState({});
	const tableRef = useRef();

	useEffect(() => {
		const interval = setInterval(() => reloadTable(false), 3000);
		INTERVALS.push(interval);
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
			placeholder: 'Search by Name'
		},
		{
			name: 'Description',
			field: 'description',
			placeholder: 'Search by Description'
		},
		{
			name: 'Reserved Space',
			field: 'capacity',
			placeholder: 'Search by Capacity',
			filterable: false,
			className: 'fixed-size-column sx-column',
			rowClassName: 'fixed-size-column',
			value: vpg => CapacityService.toBiggestUnit(vpg.capacity, unitType)
		},
		{
			name: 'Last Modified By',
			field: 'modifiedBy',
			placeholder: 'Search by Last Modifier',
			className: 'fixed-size-column md-column',
			rowClassName: 'fixed-size-column',
		},
		{
			name: 'Last Date Modified',
			field: 'dateModified',
			placeholder: 'Search by Last Date Modified',
			type: 'dateRange',
			className: 'fixed-size-column md-column',
			rowClassName: 'fixed-size-column',
		},
		{
			name: 'Actions',
			title: '',
			filterable: false,
			sortable: false,
			draggable: false,
			className: 'fixed-size-column action-column',
			rowClassName: 'fixed-size-column',
			value: (vpg) => (
				!vpg.isDefault && <a className="fa fa-pencil edit-button" onClick={() => handleEditVPG(vpg)}></a>
			),
		},
	];

	const handleEditVPG = (vpg) => {
		setVPG(vpg);
		setShowCreateEditModal(true);
	};

	const handleNewVPG = () => {
		const freshVPG = {
			diskClasses: [],
			serverClasses: [],
			VSGs: [],
			capacity: 0,
			allowOverflow: true,
			isUsedForMD: false,
			isEncrypted: false
		};

		setVPG(freshVPG);
		setShowCreateEditModal(true);
	};

	const createVpg = async(editedVpg) => {
		const responses = await VolumeProvisioningGroupsService.create([editedVpg]);
		if (responses[0].success) {
			successAlert(`${editedVpg.name} Volume Provisioning Group created successfully`);
			reloadTable();
		} else {
			const errorMsg = extractErrorMsg(responses[0].error);
			errorAlert(`Failed to create Volume Provisioning Group ${editedVpg.name} - ${errorMsg}`);
		}
	};

	const updateVpg = async(editedVpg) => {
		if (editedVpg.capacity > vpg.capacity) {
			return updateAndExtendVpg(editedVpg);
		}
		// eslint-disable-next-line no-unused-vars
		const { capacity, ...editedVpgWithoutCapacity } = editedVpg;

		const responses = await VolumeProvisioningGroupsService.update([editedVpgWithoutCapacity]);
		if (responses[0].success) {
			successAlert(`${editedVpg._id} Volume Provisioning Group updated successfully`);
			reloadTable();
		} else {
			const errorMsg = extractErrorMsg(responses[0].error);
			errorAlert(`Failed to updated Volume Provisioning Group ${editedVpg._id} - ${errorMsg}`);
		}
	};

	const updateAndExtendVpg = async(editedVpg) => {
		const { _id, uuid } = editedVpg;
		const { capacity, ...editedVpgWithoutCapacity } = editedVpg;

		const updateRes = await VolumeProvisioningGroupsService.update([editedVpgWithoutCapacity]);
		if (!updateRes[0].success) {
			const errorMsg = extractErrorMsg(updateRes[0].error);
			errorAlert(`Failed to update Volume Provisioning Group ${editedVpg._id} - ${errorMsg}`);
			return;
		}

		const extendRes = await VolumeProvisioningGroupsService.extend([{ _id, uuid, capacity }]);
		if (!extendRes[0].success) {
			const errorMsg = extractErrorMsg(extendRes[0].error);
			errorAlert(`Failed to extend Volume Provisioning Group ${editedVpg._id} - ${errorMsg}`);
			return;
		}

		successAlert(`${editedVpg._id} Volume Provisioning Group updated and extended successfully`);
		reloadTable();
	};

	const handleSubmitVPG = async(editedVpg) => {
		const isCreate = !editedVpg._id;
		if (isCreate) {
			await createVpg(editedVpg);
		} else {
			await updateVpg(editedVpg);
		}
		setShowCreateEditModal(false);
		setVPG({});
	};

	const handleDeleteVPG = async() => {
		const confirmed = await confirm(`Are you sure you want to delete ${selectedVPGs.length} Volume Provisioning Group(s)?`);
		if (!confirmed) {
			return;
		}

		const payload = selectedVPGs.map(({ _id, uuid }) => ({ _id: _id, uuid }));

		const responses = await VolumeProvisioningGroupsService.delete(payload);
		const responsesBySuccess = extractResults(responses);

		if (responsesBySuccess.success.length) {
			successAlert(`${responsesBySuccess.success.length} Volume Provisioning Group(s) deleted successfully`);
			reloadTable();
		}
		Object.keys(responsesBySuccess.failed).forEach(errorMsg => {
			const ids = responsesBySuccess.failed[errorMsg].map(entity => entity._id).join(', ');
			errorAlert(`Failed to delete Volume Provisioning Group(s) ${ids} - ${errorMsg}`);
		});
	};

	const createEditVPGModal = useMemo(() => (
		<CreateEditVPGModal
			isOpen={showCreateEditModal}
			vpg={vpg}
			handleCancel={() => {
				setShowCreateEditModal(false);
				setVPG({});
			}}
			onSubmit={handleSubmitVPG}
		/>
	), [showCreateEditModal, vpg]);

	return (
		<div className="page-content">
			{createEditVPGModal}

			<h1>Volume Provisioning Groups</h1>

			<div className="action-container">
				<button className="btn multi-select-action-btn btn-info mgmt-btn-info"
				        disabled={!selectedVPGs.length || selectedVPGs.some(vpg => vpg.isDefault)}
				        onClick={() => handleDeleteVPG()}>
					Delete
				</button>
			</div>

			<FiltSortTable
				ref={tableRef}
				tableId="volumeProvisioningGroups"
				columns={columns}
				loadTotal={VolumeProvisioningGroupsService.loadTotal}
				loadRows={VolumeProvisioningGroupsService.loadVPGs}
				multiselectOptions={{
					enabled: true,
					onSelectedRowsChange: setSelectedVPGs,
				}}
			/>

			<NewButton onClick={() => handleNewVPG()}/>
		</div>
	);
};

export default VolumeProvisioningGroups;
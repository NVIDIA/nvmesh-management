/*
 * SPDX-FileCopyrightText: Copyright (c) 2026 NVIDIA CORPORATION & AFFILIATES. All rights reserved.
 * SPDX-License-Identifier: Apache-2.0
 */

/* global React, consts */

import FiltSortTable from '../../filtsort-table/FiltSortTable.jsx';
import { useAlerts } from '../../core/Alert.jsx';
import { useConfirmationDialog } from '../../shared/ConfirmationDialog.jsx';
import { VolumesService } from '../../services/api/volumes.service.js';
import { extractErrorMsg, extractResults } from '../../utils.js';
import NewButton from '../../shared/NewButton.jsx';
import { useAppContext } from '../../App.jsx';
import CapacityService from '../../services/capacity.service.js';
import { events, SocketService } from '../../services/socket.service.js';
import CreateTPVModal from './CreateTPVModal.jsx';

const { useRef, useState, useEffect } = React;

const TPV_FILTER = { volumeClass: consts.volumeClass.TPV };

const loadRows = async(filter, sort, currentPage, count) => {
	return VolumesService.loadVolumes({ ...filter, ...TPV_FILTER }, sort, currentPage, count);
};

const loadTotal = async(filter) => VolumesService.loadTotal({ ...filter, ...TPV_FILTER });

const ThinProvisioning = () => {
	const { unitType, currUser } = useAppContext();
	const { successAlert, errorAlert } = useAlerts();
	const [confirm] = useConfirmationDialog();
	const [selectedTPVs, setSelectedTPVs] = useState([]);
	const [showCreateEditModal, setShowCreateEditModal] = useState(false);
	const [tpv, setTPV] = useState({});
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
			name: 'Parent CDV',
			field: 'tpvConfig.cdvId',
			placeholder: 'Search by CDV',
			value: tpvRow => tpvRow.tpvConfig?.cdvName || tpvRow.tpvConfig?.cdvId || '—',
		},
		{
			name: 'Virtual Size',
			field: 'tpvConfig.virtualSizeGB',
			filterable: false,
			className: 'fixed-size-column sx-column',
			rowClassName: 'fixed-size-column',
			value: tpvRow => tpvRow.tpvConfig?.virtualSizeGB != null
				? CapacityService.toBiggestUnit(tpvRow.tpvConfig.virtualSizeGB, unitType)
				: '—',
		},
		{
			name: 'Client',
			field: 'tpvConfig.exclusiveClient',
			placeholder: 'Search by Client',
			value: tpvRow => tpvRow.tpvConfig?.exclusiveClient || <em>Detached</em>,
		},
		{
			name: 'Status',
			field: 'status',
			className: 'fixed-size-column sx-column',
			rowClassName: 'fixed-size-column',
			value: tpvRow => <label className={`label bg-${tpvRow.status === consts.volumeStatuses.ONLINE ? 'green' : 'gray'}`}>
				{tpvRow.status || '—'}
			</label>,
		},
		{
			name: 'Actions',
			title: '',
			filterable: false,
			sortable: false,
			draggable: false,
			className: 'fixed-size-column sxx-column',
			rowClassName: 'fixed-size-column',
			value: tpvRow => (
				<a className="fa fa-pencil edit-button"
				   disabled={!currUser.isAdmin}
				   onClick={() => handleEditTPV(tpvRow)}></a>
			),
		},
	];

	const handleEditTPV = (tpvRow) => {
		setTPV(tpvRow);
		setShowCreateEditModal(true);
	};

	const handleNewTPV = () => {
		setTPV({});
		setShowCreateEditModal(true);
	};

	const handleDeleteTPVs = async() => {
		const deleteMsg = `Warning: You are about to delete ${selectedTPVs.length} thin-provisioned volume(s). ` +
			'The allocated extents on the CDV will be zeroed. Are you sure?';

		const confirmed = await confirm(deleteMsg);
		if (!confirmed) return;

		const tpvsToDelete = selectedTPVs.map(v => ({ _id: v._id, uuid: v.uuid }));
		const responses = await VolumesService.deleteTPV(tpvsToDelete);
		const responsesBySuccess = extractResults(responses);

		if (responsesBySuccess.success.length) {
			successAlert(`${responsesBySuccess.success.length} TPV(s) deleted successfully`);
			reloadTable();
		}
		Object.keys(responsesBySuccess.failed).forEach(errorMsg => {
			const ids = responsesBySuccess.failed[errorMsg].map(entity => entity._id).join(', ');
			errorAlert(`Failed to delete TPV(s) ${ids} - ${errorMsg}`);
		});
	};

	const handleSubmitTPV = async(editedTPV) => {
		const isCreate = !editedTPV._id;

		if (isCreate) {
			const responses = await VolumesService.createTPV([editedTPV]);
			if (responses[0]?.success) {
				successAlert(`TPV ${editedTPV.name} created successfully`);
				reloadTable();
			} else {
				errorAlert(`Failed to create TPV ${editedTPV.name} — ${extractErrorMsg(responses[0]?.error)}`);
			}
		} else {
			const newSizeGB = editedTPV.tpvConfig?.virtualSizeGB;
			const sizeChanged = newSizeGB != null && newSizeGB !== tpv.tpvConfig?.virtualSizeGB;

			if (sizeChanged) {
				const extendRes = await VolumesService.extendTPV({ tpvId: editedTPV._id, newSizeGB });
				const res = Array.isArray(extendRes) ? extendRes[0] : extendRes;
				if (!res?.success) {
					errorAlert(`Failed to extend TPV ${editedTPV._id} — ${extractErrorMsg(res?.error)}`);
					setShowCreateEditModal(false);
					setTPV({});
					return;
				}
			}

			const responses = await VolumesService.updateTPV(editedTPV);
			const res = Array.isArray(responses) ? responses[0] : responses;
			if (res?.success) {
				successAlert(`TPV ${editedTPV._id} updated successfully`);
				reloadTable();
			} else {
				errorAlert(`Failed to update TPV ${editedTPV._id} — ${extractErrorMsg(res?.error)}`);
			}
		}

		setShowCreateEditModal(false);
		setTPV({});
	};

	return (
		<div className="page-content">
			{showCreateEditModal && (
				<CreateTPVModal
					isOpen={showCreateEditModal}
					tpv={tpv}
					handleCancel={() => {
						setShowCreateEditModal(false);
						setTPV({});
					}}
					onSubmit={handleSubmitTPV}
				/>
			)}

			<h1>Thin Provisioning</h1>

			<div className="action-container">
				<button className="btn multi-select-action-btn btn-info mgmt-btn-info"
				        disabled={!currUser.isAdmin || !selectedTPVs.length}
				        onClick={handleDeleteTPVs}>
					Delete
				</button>
			</div>

			<FiltSortTable
				ref={tableRef}
				tableId="thinProvisioning"
				columns={columns}
				loadTotal={loadTotal}
				loadRows={loadRows}
				multiselectOptions={{
					enabled: true,
					onSelectedRowsChange: setSelectedTPVs,
				}}
			/>

			<NewButton onClick={handleNewTPV}
			           disabled={!currUser.isAdmin}/>
		</div>
	);
};

export default ThinProvisioning;

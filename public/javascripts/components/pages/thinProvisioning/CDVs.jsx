/*
 * SPDX-FileCopyrightText: Copyright (c) 2026 NVIDIA CORPORATION & AFFILIATES. All rights reserved.
 * SPDX-License-Identifier: Apache-2.0
 */

/* global React, consts */

import FiltSortTable from '../../filtsort-table/FiltSortTable.jsx';
import { useAlerts } from '../../core/Alert.jsx';
import { useConfirmationDialog } from '../../shared/ConfirmationDialog.jsx';
import { VolumesService } from '../../services/api/volumes.service.js';
import { extractErrorMsg, extractResults, ellipsis } from '../../utils.js';
import NewButton from '../../shared/NewButton.jsx';
import CreateEditVolumeModal from '../volumes/createEditModal/CreateEditVolumeModal.jsx';
import { useAppContext } from '../../App.jsx';
import CapacityService from '../../services/capacity.service.js';
import { AllocationService } from '../../services/allocation.service.js';
import { events, SocketService } from '../../services/socket.service.js';
import { statusToHealth, statusToCaption, actionToClass, actionToCaption } from '../volumes/Volumes.jsx';
import VolumeDiagramModal from '../volumes/volumeDiagram/VolumeDiargramModal.jsx';

const { useRef, useState, useEffect, useMemo } = React;

const CDV_FILTER = { volumeClass: consts.volumeClass.CDV };
const hiddenVolumeTypes = { [consts.RAIDLevel.JBOD]: true };

const isRebuildDisabled = (cdv) => {
	const chunks = cdv.chunks || [];
	return !chunks.some(chunk =>
		chunk.pRaids.some(pRaid =>
			pRaid.diskSegments.some(ds => ds.status === 'remap')
		)
	);
};

const loadRows = async(filter, sort, currentPage, count) => {
	return VolumesService.loadVolumes({ ...filter, ...CDV_FILTER }, sort, currentPage, count);
};

const loadTotal = async(filter) => VolumesService.loadTotal({ ...filter, ...CDV_FILTER });

const CDVs = () => {
	const { unitType, currUser } = useAppContext();
	const { successAlert, errorAlert } = useAlerts();
	const [confirm] = useConfirmationDialog();
	const [selectedCDVs, setSelectedCDVs] = useState([]);
	const [showCreateEditModal, setShowCreateEditModal] = useState(false);
	const [cdv, setCDV] = useState({});
	const [showVolumeDiagramModal, setShowVolumeDiagramModal] = useState(false);
	const [diagramCDVId, setDiagramCDVId] = useState();
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

	const handleNewCDV = () => {
		setCDV({
			capacity: 0,
			relativeRebuildPriority: 10,
			isEncrypted: false,
			isUsedAsSnapshot: false,
			isReadOnly: false,
			enableNVMf: false,
			serverClasses: [],
			diskClasses: [],
			VSGs: [],
			selectedClientsForNvmf: [],
			volumeClass: consts.volumeClass.CDV,
		});
		setShowCreateEditModal(true);
	};

	const handleEditCDV = (cdvRow) => {
		setCDV(cdvRow);
		setShowCreateEditModal(true);
	};

	const handleSubmitCDV = async(editedCDV) => {
		const isCreate = !editedCDV._id;
		if (isCreate) {
			const responses = await VolumesService.create([editedCDV]);
			if (responses[0].success) {
				successAlert(`${editedCDV.name} CDV created successfully`);
				reloadTable();
			} else {
				errorAlert(`Failed to create CDV ${editedCDV.name} - ${extractErrorMsg(responses[0].error)}`);
			}
		} else {
			// eslint-disable-next-line no-unused-vars
			const { capacity, chunks, ...cdvToUpdate } = editedCDV;
			const responses = await VolumesService.update([cdvToUpdate]);
			if (responses[0].success) {
				successAlert(`CDV ${editedCDV._id} updated successfully`);
				reloadTable();
			} else {
				errorAlert(`Failed to update CDV ${editedCDV._id} - ${extractErrorMsg(responses[0].error)}`);
			}
		}
		setShowCreateEditModal(false);
		setCDV({});
	};

	const handleDeleteCDVs = async() => {
		const deleteMsg = `Warning: You are about to delete ${selectedCDVs.length} CDV(s) and any ` +
			'associated drive allocations will be zeroed, making recovery impossible. Are you sure you want to continue?';

		const confirmed = await confirm(deleteMsg);
		if (!confirmed) return;

		const cdvsToDelete = selectedCDVs.map(v => ({ _id: v._id, uuid: v.uuid }));
		const responses = await VolumesService.delete(cdvsToDelete);
		const responsesBySuccess = extractResults(responses);

		if (responsesBySuccess.success.length) {
			successAlert(`${responsesBySuccess.success.length} CDV(s) deleted successfully`);
			reloadTable();
		}
		Object.keys(responsesBySuccess.failed).forEach(errorMsg => {
			const ids = responsesBySuccess.failed[errorMsg].map(entity => entity._id).join(', ');
			errorAlert(`Failed to delete CDV(s) ${ids} - ${errorMsg}`);
		});
	};

	const handleRebuildCDVs = async() => {
		const cdvsToRebuild = selectedCDVs.map(v => ({ _id: v._id, uuid: v.uuid }));
		if (!cdvsToRebuild.every(v => v.diskClasses?.length || v.serverClasses?.length)) {
			const rebuildMsg = 'Attention! Some CDVs do not have any classes defined. Confirming will ' +
				'start the rebuild process using any available space. If this is not acceptable, click cancel ' +
				'and then edit the CDV to define a class.';
			const confirmed = await confirm(rebuildMsg);
			if (!confirmed) return;
		}

		const confirmed = await confirm('Do you want to allocate on an offline hardware?', false, { confirmText: 'Yes', cancelText: 'No' });
		if (confirmed)
			cdvsToRebuild.forEach(v => v.allowAllocationOnOfflineDrives = true);

		const responses = await VolumesService.rebuild(cdvsToRebuild);
		const responsesBySuccess = extractResults(responses);

		if (responsesBySuccess.success.length) {
			successAlert(`${responsesBySuccess.success.length} CDV(s) rebuilt successfully`);
			reloadTable();
		}
		Object.keys(responsesBySuccess.failed).forEach(errorMsg => {
			const ids = responsesBySuccess.failed[errorMsg].map(entity => entity._id).join(', ');
			errorAlert(`Rebuild failed for CDV(s) ${ids} - ${errorMsg}`);
		});
	};

	const openVolumeDiagramModal = (cdvId) => {
		setDiagramCDVId(cdvId);
		setShowVolumeDiagramModal(true);
	};

	const columns = [
		{
			name: 'Name',
			field: 'name',
			placeholder: 'Search by Name',
			value: cdvRow => <a onClick={() => openVolumeDiagramModal(cdvRow._id)}>{cdvRow.name}</a>,
		},
		{
			name: 'Description',
			field: 'description',
			placeholder: 'Search by Description',
			value: cdvRow => ellipsis(cdvRow.description),
		},
		{
			name: 'Capacity',
			field: 'capacity',
			filterable: false,
			className: 'fixed-size-column sx-column',
			rowClassName: 'fixed-size-column',
			value: cdvRow => {
				const capacity = cdvRow.capacity === consts.volumeCapacity.MAX && cdvRow.blocks && cdvRow.blockSize ?
					cdvRow.blocks * cdvRow.blockSize :
					cdvRow.capacity;
				return CapacityService.toBiggestUnit(capacity, unitType);
			},
		},
		{
			name: 'Extent Size',
			field: 'cdvConfig.cdvExtentSizeMB',
			filterable: false,
			className: 'fixed-size-column sx-column',
			rowClassName: 'fixed-size-column',
			value: cdvRow => cdvRow.cdvConfig?.cdvExtentSizeMB != null
				? `${cdvRow.cdvConfig.cdvExtentSizeMB} MB`
				: '—',
		},
		{
			name: 'Allocated Extents',
			field: 'runtimeStats.allocatedExtents',
			filterable: false,
			className: 'fixed-size-column sx-column',
			rowClassName: 'fixed-size-column',
			value: cdvRow => cdvRow.runtimeStats?.allocatedExtents != null
				? cdvRow.runtimeStats.allocatedExtents
				: '—',
		},
		{
			name: 'Free Extents',
			filterable: false,
			sortable: false,
			className: 'fixed-size-column sx-column',
			rowClassName: 'fixed-size-column',
			value: cdvRow => {
				const { allocatedExtents, totalDataExtents } = cdvRow.runtimeStats || {};
				return (allocatedExtents != null && totalDataExtents != null)
					? totalDataExtents - allocatedExtents
					: '—';
			},
		},
		{
			name: 'Over-Provision',
			field: 'runtimeStats.overprovisionRatio',
			filterable: false,
			sortable: false,
			className: 'fixed-size-column sx-column',
			rowClassName: 'fixed-size-column',
			value: cdvRow => {
				const r = cdvRow.runtimeStats?.overprovisionRatio;
				return typeof r === 'number' ? `${r.toFixed(2)}x` : '—';
			},
		},
		{
			// Max CDV Size = (L1 entries) × cdvExtentSize.  The L1 table is
			// always 1 GiB with a 4 KiB header; each entry is 4 KiB.
			name: 'Max CDV Size',
			filterable: false,
			sortable: false,
			className: 'fixed-size-column sx-column',
			rowClassName: 'fixed-size-column',
			value: cdvRow => {
				const { cdvExtentSizeMB, allocatorSizeGB } = cdvRow.cdvConfig || {};
				if (!cdvExtentSizeMB || !allocatorSizeGB) return '—';
				const l1Entries = Math.floor(allocatorSizeGB * 1024 * 1024 * 1024 / 4096) - 1;
				const maxSizeGB = (l1Entries * cdvExtentSizeMB) / 1024;
				return CapacityService.toBiggestUnit(maxSizeGB, unitType);
			},
		},
		{
			name: 'RAID Level',
			field: 'RAIDLevel',
			placeholder: 'Search by RAID Level',
			type: 'choice',
			choices: Object.values(consts.RAIDLevel).filter(raidLevel => !hiddenVolumeTypes[raidLevel])
		},
		{
			name: 'Stripe Width',
			field: 'stripeWidth',
			filterable: false,
			className: 'fixed-size-column sx-column',
			rowClassName: 'fixed-size-column',
		},
		{
			name: 'Data Blocks',
			field: 'dataBlocks',
			filterable: false,
			className: 'fixed-size-column sx-column',
			rowClassName: 'fixed-size-column',
			value: cdvRow => cdvRow.dataBlocks || '1',
		},
		{
			name: 'Parity Blocks',
			field: 'parityBlocks',
			filterable: false,
			className: 'fixed-size-column sx-column',
			rowClassName: 'fixed-size-column',
			value: cdvRow => {
				if (AllocationService.isMirrored(cdvRow.RAIDLevel)) {
					return cdvRow.numberOfMirrors;
				}
				if (AllocationService.isEC(cdvRow.RAIDLevel)) {
					return cdvRow.parityBlocks;
				}
				return 0;
			},
		},
		{
			name: 'Last Modified By',
			field: 'modifiedBy',
			placeholder: 'Search by Last Modifier',
			rowClassName: 'fixed-size-column',
		},
		{
			name: 'Last Date Modified',
			field: 'dateModified',
			placeholder: 'Search by Last Date Modified',
			type: 'dateRange',
			className: 'md-column',
			rowClassName: 'fixed-size-column',
		},
		{
			name: 'TPVs',
			field: 'tpvCount',
			filterable: false,
			className: 'fixed-size-column sx-column',
			rowClassName: 'fixed-size-column',
			value: cdvRow => cdvRow.cdvConfig
				? `${cdvRow.tpvCount || 0} / ${cdvRow.cdvConfig.maxTPVs}`
				: '—',
		},
		{
			name: 'Action',
			field: 'action',
			className: 'fixed-size-column sx-column',
			rowClassName: 'fixed-size-column',
			sort: 'desc',
			value: cdvRow => cdvRow.action !== consts.volumeActions.NONE && (
				<label className={`label ${actionToClass(cdvRow.action)}`}>
					{cdvRow.action === 'rebuilding' || cdvRow.action === 'deleting' && <span><i className="fa fa-cog fa-spin"></i>&nbsp;</span>}
					{actionToCaption(cdvRow.action)}
				</label>),
		},
		{
			name: 'Status',
			field: 'status',
			className: 'fixed-size-column sx-column',
			rowClassName: 'fixed-size-column',
			value: cdvRow => <label className={`label bg-${statusToHealth(cdvRow.status)}`}>
				{statusToCaption(cdvRow.status)}
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
			value: cdvRow => (
				<a className="fa fa-pencil edit-button"
				   disabled={!currUser.isAdmin}
				   onClick={() => handleEditCDV(cdvRow)}></a>
			),
		},
	];

	return (
		<div className="page-content">
			{useMemo(() => (
				<CreateEditVolumeModal
					isOpen={showCreateEditModal}
					volume={cdv}
					handleCancel={() => {
						setShowCreateEditModal(false);
						setCDV({});
					}}
					onSubmit={handleSubmitCDV}
				/>
			), [showCreateEditModal, cdv])}

			<VolumeDiagramModal
				isOpen={showVolumeDiagramModal}
				handleCancel={() => setShowVolumeDiagramModal(false)}
				volumeId={diagramCDVId}
			/>

			<h1>CDVs</h1>

			<div className="action-container">
				<button className="btn multi-select-action-btn btn-info mgmt-btn-info"
				        disabled={!currUser.isAdmin || !selectedCDVs.length}
				        onClick={handleDeleteCDVs}>
					Delete
				</button>
				<button className="btn multi-select-action-btn btn-info mgmt-btn-info"
				        disabled={!currUser.isAdmin || !selectedCDVs.length || selectedCDVs.some(isRebuildDisabled)}
				        onClick={handleRebuildCDVs}>
					Rebuild
				</button>
			</div>

			<FiltSortTable
				ref={tableRef}
				tableId="cdvs"
				columns={columns}
				loadTotal={loadTotal}
				loadRows={loadRows}
				multiselectOptions={{
					enabled: true,
					onSelectedRowsChange: setSelectedCDVs,
				}}
			/>

			<NewButton onClick={handleNewCDV}
			           disabled={!currUser.isAdmin}/>
		</div>
	);
};

export default CDVs;

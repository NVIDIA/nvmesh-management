/*
 * SPDX-FileCopyrightText: Copyright (c) 2026 NVIDIA CORPORATION & AFFILIATES. All rights reserved.
 * SPDX-License-Identifier: Apache-2.0
 */

/* global React */

import { ReleasesService } from '../../services/api/release.service.js';
import { useAlerts } from '../../core/Alert.jsx';
import useQueryParams from '../../useQueryParams.hook.js';
import { extractErrorMsg, extractResults } from '../../utils.js';
import { events, SocketService } from '../../services/socket.service.js';
import { useConfirmationDialog } from '../../shared/ConfirmationDialog.jsx';
import FiltSortTable from '../../filtsort-table/FiltSortTable.jsx';
import NewButton from '../../shared/NewButton.jsx';
import CreateEditReleaseModal from './CreateEditReleaseModal.jsx';

const { useRef, useState, useEffect } = React;

const Releases = () => {
	const tableRef = useRef();
	const [release, setRelease] = useState({});
	const [selectedReleases, setSelectedReleases] = useState([]);
	const [showCreateEditModal, setShowCreateEditModal] = useState(false);
	const { getQueryParam, setQueryParam } = useQueryParams();
	const { successAlert, errorAlert } = useAlerts();
	const [confirm] = useConfirmationDialog();

	useEffect(() => {
		const createParam = getQueryParam('create');
		if (createParam) {
			newRelease(createParam);
		}

		SocketService.addHandler(events.newReleaseEvent.name, () => reloadTable());
	}, []);

	const columns = [
		{
			name: 'Version',
			field: 'version',
			placeholder: 'Search by Version',
		},
		{
			name: 'Artifacts',
			field: 'artifacts',
			filterable: false,
			sortable: false,
			className: 'fixed-size-column sx-column',
			rowClassName: 'fixed-size-column',
			value: row => row.artifacts.length
		},
		{
			name: 'Actions',
			title: '',
			filterable: false,
			sortable: false,
			draggable: false,
			className: 'fixed-size-column action-column',
			rowClassName: 'fixed-size-column',
			value: (row) => (
				<a className="fa fa-pencil edit-button" onClick={() => editRelease(row)}></a>
			),
		}
	];


	const reloadTable = () => {
		if (tableRef.current) {
			tableRef.current.reloadRows();
			tableRef.current.reloadTotal();
		}
	};

	const loadRows = async(filter, sort, currentPage, count) => {
		const releases = await ReleasesService.loadReleases(filter, sort, currentPage, count);
		releases.forEach(release => {
			SocketService.addHandler(SocketService.getReleaseID(release.ID) + events.releaseChangedEvent.name, () => reloadTable());
			SocketService.addHandler(SocketService.getReleaseID(release.ID) + events.releaseRemovedEvent.name, () => reloadTable());
		});
		return releases;
	};

	const createRelease = async(release) => {
		const responses = await ReleasesService.create([release]);
		if (responses[0].success) {
			successAlert(`${release.version} Release created successfully`);
			reloadTable();
		} else {
			const errorMsg = extractErrorMsg(responses[0].error);
			errorAlert(`Failed to create Release ${release.version} - ${errorMsg}`);
		}
	};

	const updateRelease = async(release) => {
		const responses = await ReleasesService.update([release]);
		if (responses[0].success) {
			successAlert(`Release ${release.version} updated successfully`);
			reloadTable();
		} else {
			const errorMsg = extractErrorMsg(responses[0].error);
			errorAlert(`Failed to updated Release ${release.version} - ${errorMsg}`);
		}
	};

	const deleteReleases = async() => {
		const confirmed = await confirm(`Are you sure you want to delete ${selectedReleases.length} Release(s)?`);
		if (!confirmed) {
			return;
		}

		const payload = selectedReleases.map((s) => ({ ID: s.ID, name: s.name }));

		const responses = await ReleasesService.delete(payload);
		const responsesBySuccess = extractResults(responses);

		if (responsesBySuccess.success.length) {
			successAlert(`${responsesBySuccess.success.length} Release(s) deleted successfully`);
			reloadTable();
		}
		Object.keys(responsesBySuccess.failed).forEach(errorMsg => {
			const ids = responsesBySuccess.failed[errorMsg].map(entity => entity.ID).join(', ');
			errorAlert(`Failed to delete Release(s) ${ids} - ${errorMsg}`);
		});
	};

	const editRelease = (release) => {
		setRelease(release);
		setShowCreateEditModal(true);
	};

	const newRelease = (initialRelease = {}) => {
		setShowCreateEditModal(true);
		setRelease(initialRelease);
	};

	const onCancelCreateEditRelease = () => {
		setShowCreateEditModal(false);
		setRelease({});
		setQueryParam('create', null);
	};

	const onSubmitRelease = async(editedRelease) => {
		const isCreate = !editedRelease.ID;
		if (isCreate) {
			await createRelease(editedRelease);
		} else {
			await updateRelease(editedRelease);
		}
		setShowCreateEditModal(false);
		setRelease({});
		setQueryParam('create', null);
	};

	return (
		<div className="page-content">
			<CreateEditReleaseModal isOpen={showCreateEditModal}
			                         release={release}
			                         handleCancel={() => onCancelCreateEditRelease()}
			                         onSubmit={release => onSubmitRelease(release)}/>
			<h1>Releases</h1>

			<div className="action-container">
				<button className="btn btn-info mgmt-btn-info"
				        disabled={selectedReleases.length === 0}
				        onClick={() => deleteReleases()}>
					Delete
				</button>
			</div>

			<FiltSortTable
				tableId="releasesPage"
				rowIdentifier="ID"
				ref={tableRef}
				columns={columns}
				loadTotal={ReleasesService.loadTotal}
				loadRows={loadRows}
				multiselectOptions={{
					enabled: true,
					onSelectedRowsChange: selectedRows => {
						setSelectedReleases(selectedRows);
					}
				}}
			/>

			<NewButton onClick={() => newRelease()} />

		</div>
	);
};

export default Releases;
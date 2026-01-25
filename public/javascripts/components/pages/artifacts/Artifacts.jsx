/*
 * SPDX-FileCopyrightText: Copyright (c) 2026 NVIDIA CORPORATION & AFFILIATES. All rights reserved.
 * SPDX-License-Identifier: Apache-2.0
 */

/* global React */

import { ArtifactsService } from '../../services/api/artifacts.service.js';
import { useAlerts } from '../../core/Alert.jsx';
import useQueryParams from '../../useQueryParams.hook.js';
import { extractErrorMsg, extractResults } from '../../utils.js';
import { events, SocketService } from '../../services/socket.service.js';
import { useConfirmationDialog } from '../../shared/ConfirmationDialog.jsx';
import NewButton from '../../shared/NewButton.jsx';
import CreateEditArtifactModal from '../artifacts/CreateEditArtifactModal.jsx';
import ArtifactsFiltSort from './ArtifactsFiltSort.jsx';

const { useRef, useState, useEffect } = React;

const Artifacts = () => {
	const tableRef = useRef();
	const [artifact, setArtifact] = useState({});
	const [selectedArtifacts, setSelectedArtifacts] = useState([]);
	const [showCreateEditModal, setShowCreateEditModal] = useState(false);
	const { getQueryParam, setQueryParam } = useQueryParams();
	const { successAlert, errorAlert } = useAlerts();
	const [confirm] = useConfirmationDialog();

	useEffect(() => {
		const createParam = getQueryParam('create');
		if (createParam) {
			newArtifact(createParam);
		}

		SocketService.addHandler(events.newArtifactEvent.name, () => reloadTable());
	}, []);

	const columns = [
		{
			name: 'Actions',
			title: '',
			filterable: false,
			sortable: false,
			draggable: false,
			className: 'fixed-size-column action-column',
			rowClassName: 'fixed-size-column',
			value: (row) => (
				<a className="fa fa-pencil edit-button" onClick={() => editArtifact(row)}></a>
			),
		}
	];

	const reloadTable = () => {
		if (tableRef.current) {
			tableRef.current.reloadRows();
			tableRef.current.reloadTotal();
		}
	};

	const createArtifact = async(artifact) => {
		const responses = await ArtifactsService.create([artifact]);
		if (responses[0].success) {
			successAlert(`${artifact.name} Artifact created successfully`);
			reloadTable();
		} else {
			const errorMsg = extractErrorMsg(responses[0].error);
			errorAlert(`Failed to create Artifact ${artifact.name} - ${errorMsg}`);
		}
	};

	const updateArtifact = async(artifact) => {
		const responses = await ArtifactsService.update([artifact]);
		if (responses[0].success) {
			successAlert(`Artifact ${artifact.name} updated successfully`);
			reloadTable();
		} else {
			const errorMsg = extractErrorMsg(responses[0].error);
			errorAlert(`Failed to updated Artifact ${artifact.name} - ${errorMsg}`);
		}
	};

	const deleteArtifacts = async() => {
		const confirmed = await confirm(`Are you sure you want to delete ${selectedArtifacts.length} Artifact(s)?`);
		if (!confirmed) {
			return;
		}

		const payload = selectedArtifacts.map((s) => ({ ID: s.ID, name: s.name }));

		const responses = await ArtifactsService.delete(payload);
		const responsesBySuccess = extractResults(responses);

		if (responsesBySuccess.success.length) {
			successAlert(`${responsesBySuccess.success.length} Artifact(s) deleted successfully`);
			reloadTable();
		}
		Object.keys(responsesBySuccess.failed).forEach(errorMsg => {
			const ids = responsesBySuccess.failed[errorMsg].map(entity => entity.ID).join(', ');
			errorAlert(`Failed to delete Artifact(s) ${ids} - ${errorMsg}`);
		});
	};

	const editArtifact = (artifact) => {
		setArtifact(artifact);
		setShowCreateEditModal(true);
	};

	const newArtifact = (initialArtifact = {}) => {
		setShowCreateEditModal(true);
		setArtifact(initialArtifact);
	};

	const onCancelCreateEditArtifact = () => {
		setShowCreateEditModal(false);
		setArtifact({});
		setQueryParam('create', null);
	};

	const onSubmitArtifact = async(editedArtifact) => {
		const isCreate = !editedArtifact.ID;
		if (isCreate) {
			await createArtifact(editedArtifact);
		} else {
			await updateArtifact(editedArtifact);
		}
		setShowCreateEditModal(false);
		setArtifact({});
		setQueryParam('create', null);
	};

	return (
		<div className="page-content">
			<CreateEditArtifactModal isOpen={showCreateEditModal}
			                         artifact={artifact}
			                         handleCancel={() => onCancelCreateEditArtifact()}
			                         onSubmit={artifact => onSubmitArtifact(artifact)}/>
			<h1>Artifacts</h1>

			<div className="action-container">
				<button className="btn btn-info mgmt-btn-info"
				        disabled={selectedArtifacts.length === 0}
				        onClick={() => deleteArtifacts()}>
					Delete
				</button>
			</div>

			<ArtifactsFiltSort
				tableId="artifactsPage"
				tableRef={tableRef}
				columns={columns}
				multiselectOptions={{
					enabled: true,
					onSelectedRowsChange: selectedRows => {
						setSelectedArtifacts(selectedRows);
					}
				}}
			/>

			<NewButton onClick={() => newArtifact()} />

		</div>
	);
};

export default Artifacts;

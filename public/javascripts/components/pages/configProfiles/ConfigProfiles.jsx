/*
 * SPDX-FileCopyrightText: Copyright (c) 2026 NVIDIA CORPORATION & AFFILIATES. All rights reserved.
 * SPDX-License-Identifier: Apache-2.0
 */

/* global React, jQuery */

import { useAlerts } from '../../core/Alert.jsx';
import FiltSortTable from '../../filtsort-table/FiltSortTable.jsx';
import { useConfirmationDialog } from '../../shared/ConfirmationDialog.jsx';
import NewButton from '../../shared/NewButton.jsx';
import { ConfigurationProfilesService } from '../../services/api/configuration-profiles.service.js';
import { SocketService, events } from '../../services/socket.service.js';
import { useAppContext } from '../../App.jsx';
import { extractErrorMsg, extractResults } from '../../utils.js';
import CreateEditConfigProfileModal from './CreateEditConfigProfile.jsx';
import ExpandableList from '../../core/ExpandableList.jsx';
import SelectProfileNodesModal from './SelectProfileNodes.jsx';

const { useRef, useState, useEffect } = React;

const ConfigProfiles = () => {
	const tableRef = useRef();
	const { currUser } = useAppContext();
	const { successAlert, errorAlert } = useAlerts();
	const [confirm] = useConfirmationDialog();
	const [selectedProfiles, setSelectedProfiles] = useState([]);
	const [profileToEdit, setProfileToEdit] = useState({});
	const [showCreateEditModal, setShowCreateEditModal] = useState(false);
	const [showSelectNodesModal, setShowSelectNodesModal] = useState(false);

	useEffect(() => {
		SocketService.addHandler(events.newClientEvent.name, reloadTable);
	}, []);

	const reloadTable = () => {
		if (tableRef.current) {
			tableRef.current.reloadRows();
			tableRef.current.reloadTotal();
		}
	};

	const columns = [
		{
			name: 'Name',
			title: 'Name',
			field: '_id',
			placeholder: 'Search by Profile Name',
			sort: 'asc'
		},
		{
			name: 'Labels',
			field: 'labels',
			filterable: true,
			value: profile => {
				return (
					<ExpandableList
						items={profile.labels}
						maxItems={2}
					/>
				);
			  }
		},
		{
			name: '# Nodes',
			field: 'actions',
			filterable: false,
			value: profile => profile.hosts?.length
		},
		{
			name: 'Version',
			field: 'version',
			placeholder: 'Search by Version',
			className: 'fixed-size-column md-column',
			rowClassName: 'fixed-size-column',
		},
		{
			name: 'Last Modified By',
			field: 'modifiedBy',
			placeholder: 'Search by Last Modifier',
		},
		{
			name: 'Last Date Modified',
			field: 'dateModified',
			type: 'dateRange',
		},
		{
			name: 'Actions',
			title: '',
			filterable: false,
			sortable: false,
			draggable: false,
			className: 'fixed-size-column sxx-column',
			rowClassName: 'fixed-size-column',
			value: profile => {
				return (
					<a className={`fa edit-button ${profile.editNotAllowed ? 'fa-lock' : 'fa-pencil'}`}
						onClick={() => handleEditConfigProfile(profile)}></a>
				);
			}
		},
	];

	const afterSubmit = async() => {
		setProfileToEdit({});
		reloadTable();
	};

	const handleCreateNewConfigProfile = async() => {
		// start with NVMesh Default profile
		const newProfile = await ConfigurationProfilesService.getNVMeshDefaultProfile();
		newProfile.name = '';
		newProfile._id = null;
		newProfile.labels = [];
		newProfile.editNotAllowed = false;
		newProfile.deleteNotAllowed = false;
		newProfile.isNewProfile = true;

		setProfileToEdit(newProfile);
		setShowCreateEditModal(true);
	};

	const getAffectedNodesByDeletion = () => {
		let affectedNodes = new Set();
		selectedProfiles.forEach(p => {
			let nodes = p.hosts || [];
			nodes.forEach(n => affectedNodes.add(n));
		});
		return affectedNodes;
	};


	const createConfigProfile = async(editedProfile) => {
		delete editedProfile.isNewProfile;
		const responses = await ConfigurationProfilesService.create([editedProfile]);
		if (responses[0].success) {
			successAlert(`${editedProfile.name} Configuration Profile created successfully`);
		} else {
			const errorMsg = extractErrorMsg(responses[0].error);
			errorAlert(`Failed to create Configuration Profile "${editedProfile.name}" - ${errorMsg}`);
		}
	};

	const updateConfigProfile = async(editedProfile) => {
		const responses = await ConfigurationProfilesService.update([editedProfile]);
		if (responses[0].success) {
			successAlert(`${editedProfile.name} Config Profile updated successfully`);
		} else {
			const errorMsg = extractErrorMsg(responses[0].error);
			errorAlert(`Failed to updated Config Profile ${editedProfile.name} - ${errorMsg}`);
		}
	};

	const handleSubmitProfile = async(editedProfile) => {
		setShowCreateEditModal(false);

		try {
			if (editedProfile.isNewProfile) {
				await createConfigProfile(editedProfile);
			} else {
				await updateConfigProfile(editedProfile);
			}
		} catch (err) {
			// errorAlert already shown in the service
		}

		afterSubmit();
	};


	const handleApplyNodes = async(profile, selectedNodes) => {
		setShowSelectNodesModal(false);

		const nodeIDs = selectedNodes.map(row => row._id);
		const response = await ConfigurationProfilesService.apply(profile.name, profile.uuid, nodeIDs);
		if (response.success) {
			successAlert(`configuration profile ${profile.name} applied successfully`);
		} else {
			const errorMsg = extractErrorMsg(response.error);
			errorAlert(`Failed to apply configuration profile on nodes ${profile.name} - ${errorMsg}`);
		}

		afterSubmit();
	};

	const handleDeleteProfile = async() => {
		let affectedNodes = getAffectedNodesByDeletion();
		let numberOfProfiles = selectedProfiles.length;
		let text = '';
		let MAX_ITEMS_TO_LIST = 5; // below this value the warning will list the profile names and or node names
		if (numberOfProfiles == 1) {
			text = `Deleting configuration profile "${selectedProfiles[0].name}"`;
		} else if (numberOfProfiles > MAX_ITEMS_TO_LIST) {
			text = `Deleting ${numberOfProfiles} configuration profiles`;
		} else if (numberOfProfiles <= MAX_ITEMS_TO_LIST) {
			text = `Deleting the following ${numberOfProfiles} configuration profiles:`;
			selectedProfiles.forEach(function(p) {
				text += `<li>${p.name}</li>`;
			});
		}

		if (affectedNodes.size > 0)
			text += `</br>will revert ${affectedNodes.size} associated Nodes to the Cluster Default Profile.`;

		if (affectedNodes.size <= MAX_ITEMS_TO_LIST)
			affectedNodes.forEach(function(nodeID) {
				text += `<li>${nodeID}</li>`;
			});
		text += '</br>Do you want to continue?';

		const confirmed = await confirm(text);
		if (!confirmed) {
			return;
		}

		const payload = selectedProfiles.map(({ _id, uuid }) => ({ _id: _id, uuid }));

		const responses = await ConfigurationProfilesService.delete(payload);
		const responsesBySuccess = extractResults(responses);

		if (responsesBySuccess.success.length) {
			successAlert(`${responsesBySuccess.success.length} Configuration Profile(s) deleted successfully`);
			reloadTable();
		}
		Object.keys(responsesBySuccess.failed).forEach(errorMsg => {
			const ids = responsesBySuccess.failed[errorMsg].map(entity => entity._id).join(', ');
			errorAlert(`Failed to delete Configuration Profile(s) ${ids} - ${errorMsg}`);
		});
	};

	const loadRows = async(filter, sort, currentPage, count) => {
		const profiles = await ConfigurationProfilesService.get(filter, sort, currentPage, count);
		const profilesByUUID = {};
		profiles.forEach(p => {
			profilesByUUID[p.uuid] = p;
			p.hosts = [];
		});

		// get all nodeConfigs in a single query
		const filterByProfiles = { 'desiredProfile.id': { $in: Object.keys(profilesByUUID) } };
		let nodeConfigs = await ConfigurationProfilesService.getNodesConfigs(filterByProfiles);

		// add nodeIDs to profile.hosts
		nodeConfigs.forEach(nodeConfig => {
			let uuid = nodeConfig.desiredProfile.id;
			profilesByUUID[uuid].hosts.push(nodeConfig._id);
		});

		return profiles;
	};

	const handleCloneProfile = () => {
		let clonedProfile = cloneProfile(selectedProfiles[0]);
		setProfileToEdit(clonedProfile);
		setShowCreateEditModal(true);
	};

	const cloneProfile = function(profileToClone) {
		const profile = jQuery.extend(true, {}, profileToClone);
		profile.name += ' - Cloned';
		delete profile._id;
		delete profile.editNotAllowed;
		delete profile.deleteNotAllowed;
		delete profile.isCreatedAutomatically;
		profile.hosts = [];
		profile.isNewProfile = true;
		return profile;
	};

	const handleEditConfigProfile = async(profile) => {
		const profileCopy = jQuery.extend(true, {}, profile);
		setProfileToEdit(profileCopy);
		setShowCreateEditModal(true);
	};

	const handleSelectNodes = () => {
		const profileCopy = jQuery.extend(true, {}, selectedProfiles[0]);
		setProfileToEdit(profileCopy);
		setShowSelectNodesModal(true);
	};

	return (
		<div className="page-content">
			<CreateEditConfigProfileModal
				isOpen={showCreateEditModal}
				profile={profileToEdit}
				handleCancel={() => {
					setShowCreateEditModal(false);
					setProfileToEdit({});
				}}
				onSubmitProfile={handleSubmitProfile}
				onApplyNodes={handleApplyNodes}
			/>

			<SelectProfileNodesModal
				isOpen={showSelectNodesModal}
				profile={profileToEdit}
				handleCancel={() => {
					setShowSelectNodesModal(false);
				}}
				onApplyNodes={handleApplyNodes}
			/>

			<h1>Configuration Profiles</h1>

			<div className="action-container">
				<button className="btn multi-select-action-btn btn-info mgmt-btn-info"
				        disabled={
						 	!currUser.isAdmin ||
							!selectedProfiles.length ||
							selectedProfiles.some(p => p.deleteNotAllowed)
					}
				        onClick={() => handleDeleteProfile()}>
					Delete
				</button>
				<button className="btn multi-select-action-btn btn-info mgmt-btn-info"
				        disabled={!currUser.isAdmin || selectedProfiles.length != 1}
				        onClick={() => handleCloneProfile()}>
					Clone
				</button>
				<button className="btn multi-select-action-btn btn-info mgmt-btn-info"
				        disabled={!currUser.isAdmin || selectedProfiles.length != 1}
				        onClick={() => handleSelectNodes()}>
					Select Nodes
				</button>
			</div>

			<FiltSortTable ref={tableRef}
			               tableId="configurationProfiles"
			               columns={columns}
			               loadTotal={ConfigurationProfilesService.loadTotal}
			               loadRows={loadRows}
			               multiselectOptions={{
				               enabled: true,
				               onSelectedRowsChange: selectedRows => {
					               setSelectedProfiles(selectedRows);
				               }
			               }}
			/>
			<NewButton onClick={() => handleCreateNewConfigProfile()}/>
		</div>
	);
};

export default ConfigProfiles;
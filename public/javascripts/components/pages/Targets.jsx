/*
 * SPDX-FileCopyrightText: Copyright (c) 2026 NVIDIA CORPORATION & AFFILIATES. All rights reserved.
 * SPDX-License-Identifier: Apache-2.0
 */

/* global React, consts */

import FiltSortTable from '../filtsort-table/FiltSortTable.jsx';
import { TargetsService } from '../services/api/targets.service.js';
import { extractErrorMsg, extractResults, keyBy } from '../utils.js';
import { useAlerts } from '../core/Alert.jsx';
import { useConfirmationDialog } from '../shared/ConfirmationDialog.jsx';
import ConfigurationProfileModal from '../shared/ConfigurationProfileModal.jsx';
import { ConfigurationProfilesService } from '../services/api/configuration-profiles.service.js';
import { SocketService, events } from '../services/socket.service.js';
import AssignZoneModal from '../shared/AssignZoneModal.jsx';
import { useAppContext } from '../App.jsx';
import ConfigProfileView from './configProfiles/ConfigProfileView.jsx';
const { useRef, useState, useEffect } = React;

const healthToIcon = {
	healthy: 'ion-checkmark-circled green',
	alarm: 'ion-alert-circled yellow',
	critical: 'fa fa-exclamation-circle red'
};

const getTargetHealthIcon = (target, isZonesMode) => {
	if (target.tomaStatus === consts.tomaStatuses.DOWN || target.tomaStatus === consts.tomaStatuses.UNAVAILABLE)
		return healthToIcon.critical;

	if (isZonesMode && target.isPending)
		return healthToIcon.alarm;

	return healthToIcon[target.health];
};

const getTargetStatus = (target, isZonesMode) => {
	if (isZonesMode && target.isPending)
		return 'Approval is required';

	if (target.tomaStatus === consts.tomaStatuses.DOWN)
		return 'Toma is down';

	if (target.tomaStatus === consts.tomaStatuses.UNAVAILABLE)
		return 'Target status Unavailable';

	if (target.node_status === consts.nodeStatus.DOWN)
		return 'OFFLINE';

	if (target.health !== consts.targetHealth.HEALTHY)
		if (target.health === consts.targetHealth.ALARM)
			return (target.tomaStatus === 'unavailable'
				? 'Cannot determine TOMA status'
				: 'Target functional, but either a drive or a NIC is missing.');
	if (target.health === consts.targetHealth.CRITICAL)
		return 'Node up, but target software is not functional';

	return 'OK';
};

const Targets = () => {
	const tableRef = useRef();
	const { currUser, generalSettings } = useAppContext();
	const { successAlert, errorAlert } = useAlerts();
	const [confirm] = useConfirmationDialog();
	const [selectedTargets, setSelectedTargets] = useState([]);
	const [showConfigProfileModal, setShowConfigProfileModal] = useState(false);
	const [showSetZone, setShowSetZone] = useState(false);
	const isZoneMode = generalSettings?.enableZones;

	useEffect(() => {
		const interval = setInterval(() => reloadTable(false), 3000);
		return () => clearInterval(interval);
	}, []);

	const reloadTable = (deselectMissingRows = true) => {
		if (tableRef.current) {
			tableRef.current.reloadRows(deselectMissingRows);
			tableRef.current.reloadTotal();
		}
	};

	const columns = [
		{
			name: 'Target',
			title: 'Target ID',
			field: 'node_id',
			placeholder: 'Search by Target ID',
			sort: 'asc',
			value: target => <a href={`/servers/server/${target.node_id}`}>{target.node_id}</a>
		},
		{
			name: 'Drives',
			field: 'drives',
			filterable: false,
			sortable: false,
			className: 'fixed-size-column sx-column',
			rowClassName: 'fixed-size-column',
			value: target => target.disks.length

		},
		{
			name: 'NICs',
			field: 'nics',
			filterable: false,
			sortable: false,
			className: 'fixed-size-column sx-column',
			rowClassName: 'fixed-size-column',
			value: target => target.nics.length
		},
		{
			name: 'Zone',
			field: 'zone',
			filterable: false,
			className: 'fixed-size-column sx-column',
			rowClassName: 'fixed-size-column sx-column',
		},
		{
			name: 'Config Profile',
			field: 'configProfile.name',
			placeholder: 'Search by Profile',
			className: 'fixed-size-column lg-column',
			rowClassName: 'fixed-size-column',
			value: target => <>
				<ConfigProfileView
					configProfile={target.configProfile}
					desiredConfigProfile={target.configProfile?.desiredProfile}
					restartRequired={target.restartRequired} />
			</>
		},
		{
			name: 'Leader',
			field: 'leaderUUID',
			placeholder: 'Search by Leader UUID',
			className: 'fixed-size-column sx-column',
			rowClassName: 'fixed-size-column',
		},
		{
			name: 'Version',
			field: 'version',
			placeholder: 'Search by Version',
			className: 'fixed-size-column md-column',
			rowClassName: 'fixed-size-column',
		},
		{
			name: 'Health',
			field: 'health',
			filterable: false,
			className: 'fixed-size-column sx-column',
			rowClassName: 'fixed-size-column table-icon',
			value: target => <span className={getTargetHealthIcon(target, isZoneMode)} title={getTargetStatus(target, isZoneMode)}></span>
		}
	];

	useEffect(() => {
		SocketService.addHandler(events.newTargetEvent.name, () => reloadTable());
	}, []);

	const loadRows = async(filter, sort, currentPage, count) => {
		const targets = await TargetsService.loadTargets(filter, sort, currentPage, count);

		targets.forEach(target => {
			SocketService.addHandler(SocketService.getTargetID(target.node_id) + events.targetRemovedEvent.name, () => {
				reloadTable();
			});
			SocketService.addHandler(SocketService.getTargetID(target.node_id) + events.targetFailureEvent.name, ({ payload }) => {
				tableRef.current?.updateRow(payload._id, { ...target, health: payload.health });
			});
			SocketService.addHandler(SocketService.getTargetID(target.node_id) + events.targetWentOnlineEvent.name, ({ payload }) => {
				tableRef.current?.updateRow(payload._id, { ...target, health: payload.health });
			});
			SocketService.addHandler(SocketService.getTargetID(target.node_id) + events.clientConfigProfileUpdated.name, ({ payload }) => {
				tableRef.current?.updateRow(payload._id, { ...target, configProfile: Object.assign(target.configProfile || {}, payload.profile) });
			});
			SocketService.addHandler(SocketService.getTargetID(target.node_id) + events.restartRequiredChanged.name, ({ payload }) => {
				tableRef.current?.updateRow(payload._id, { ...target, restartRequired: payload.restartRequired });
			});
			SocketService.addHandler(SocketService.getNodeID(target.node_id) + events.configProfileUserOverrideChanged.name, ({ payload }) => {
				tableRef.current?.updateRow(payload._id, { ...target, configProfile: Object.assign(target.configProfile || {}, payload.profile) });
			});
		});

		const nodesIDs = targets.map(target => target.node_id);
		const profiles = await ConfigurationProfilesService.getNodesConfigs({ _id: { $in: nodesIDs } });
		const targetsById = keyBy(targets, t => t._id);

		profiles.forEach((profile) => {
			const target = targetsById[profile._id];
			if (target) {
				target.configProfile = target.configProfile || {};
				Object.assign(target.configProfile, profile);
			}
		});

		return targets;
	};

	const deleteTargets = async() => {
		const confirmed = await confirm(`Are you sure you want to delete ${selectedTargets.length} target(s)?`);
		if (!confirmed) {
			return;
		}

		const payload = selectedTargets.map(({ _id, uuid }) => ({ _id: _id, uuid }));

		const responses = await TargetsService.delete(payload);
		const responsesBySuccess = extractResults(responses);

		if (responsesBySuccess.success.length) {
			successAlert(`${responsesBySuccess.success.length} Target(s) deleted successfully`);
			reloadTable();
		}
		Object.keys(responsesBySuccess.failed).forEach(errorMsg => {
			const ids = responsesBySuccess.failed[errorMsg].map(entity => entity._id).join(', ');
			errorAlert(`Failed to delete Targets ${ids} - ${errorMsg}`);
		});
	};

	const createTargetClass = () => {
		const targetNodes = selectedTargets.map(target => target.node_id);
		const targetClass = JSON.stringify({ targetNodes });
		window.location.href = `/serverClasses?create=${targetClass}`;
	};

	const onApplyProfile = async(profile) => {
		const nodeIDs = selectedTargets.map(target => target.node_id);
		const response = await ConfigurationProfilesService.apply(profile.name, profile.uuid, nodeIDs);
		if (response.success) {
			successAlert(`configuration profile ${profile.name} applied successfully`);
			reloadTable();
		} else {
			const errorMsg = extractErrorMsg(response.error);
			errorAlert(`Failed to apply configuration profile on nodes ${profile.name} - ${errorMsg}`);
		}
		setShowConfigProfileModal(false);
	};

	const onSetZone = async(zoneId) => {
		const targetIds = selectedTargets.map(({ _id, uuid }) => ({ _id, uuid }));

		const responses = await TargetsService.setZone(zoneId, targetIds);
		const responsesBySuccess = extractResults(responses);

		if (responsesBySuccess.success.length) {
			const ids = responsesBySuccess.success.map(entity => entity._id).join(', ');
			successAlert(`targets ${ids} approved successfully for zone ${zoneId}`);
			reloadTable();
		}
		Object.keys(responsesBySuccess.failed).forEach(errorMsg => {
			const ids = responsesBySuccess.failed[errorMsg].map(entity => entity._id).join(', ');
			errorAlert(`Failed to set zone ${zoneId} for targets ${ids} - ${errorMsg}`);
		});

		setShowSetZone(false);
	};

	return (
		<div className="page-content">
			<ConfigurationProfileModal isOpen={showConfigProfileModal}
			                           nodeIDs={selectedTargets.map(target => target.node_id)}
			                           handleCancel={() => setShowConfigProfileModal(false)}
			                           onSubmit={profile => onApplyProfile(profile)}/>
			<AssignZoneModal isOpen={showSetZone}
			                 handleCancel={() => setShowSetZone(false)}
			                 onSubmit={zone => onSetZone(zone)}/>

			<h1>Targets</h1>

			<div className="action-container">
				<button className="btn multi-select-action-btn btn-info mgmt-btn-info"
				        disabled={!currUser.isAdmin || !selectedTargets.length || selectedTargets.some(target => target.tomaStatus === consts.tomaStatuses.UP)}
				        onClick={() => deleteTargets()}>
					Delete
				</button>
				{isZoneMode && <button className="btn multi-select-action-btn btn-info mgmt-btn-info"
				                       disabled={!currUser.isAdmin || !selectedTargets.length || selectedTargets.some(target => !!target.zone)}
				                       onClick={() => setShowSetZone(true)}>
					Approve
				</button>}
				<button className="btn multi-select-action-btn btn-info mgmt-btn-info"
				        disabled={!currUser.isAdmin || !selectedTargets.length}
				        onClick={() => setShowConfigProfileModal(true)}>
					Configure
				</button>
				<div className="separator multi-select-action-btn"></div>

				<button className="btn multi-select-action-btn btn-info mgmt-btn-info"
				        disabled={!currUser.isAdmin || !selectedTargets.length}
				        onClick={() => createTargetClass()}>
					Create Target class
				</button>
			</div>

			<FiltSortTable ref={tableRef}
			               tableId="targets"
			               columns={columns}
			               loadTotal={TargetsService.loadTotal}
			               loadRows={loadRows}
			               multiselectOptions={{
				               enabled: true,
				               onSelectedRowsChange: selectedRows => {
					               setSelectedTargets(selectedRows);
				               }
			               }}
			/>
		</div>
	);
};

export default Targets;

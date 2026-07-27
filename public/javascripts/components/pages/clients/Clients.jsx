/* global React, consts, INTERVALS */

import FiltSortTable from '../../filtsort-table/FiltSortTable.jsx';
import { ClientsService } from '../../services/api/clients.service.js';
import { extractErrorMsg, extractResults, keyBy, partition } from '../../utils.js';
import { useAlerts } from '../../core/Alert.jsx';
import { useConfirmationDialog } from '../../shared/ConfirmationDialog.jsx';
import ConfigurationProfileModal from '../../shared/ConfigurationProfileModal.jsx';
import AttachDetachModal from './AttachDetachModal.jsx';
import { ConfigurationProfilesService } from '../../services/api/configuration-profiles.service.js';
import { SocketService, events } from '../../services/socket.service.js';
import { useAppContext } from '../App.jsx';
import ConfigProfileView from '../configProfiles/ConfigProfileView.jsx';

const { useRef, useState, useEffect, useMemo } = React;

const getClientHealthIcon = client => {
	const healthToIcon = {
		healthy: 'ion-checkmark-circled green',
		alarm: 'ion-alert-circled yellow',
		critical: 'fa fa-exclamation-circle red'
	};

	return healthToIcon[client.health];
};

const getClientStatus = client => {
	if (client.client_status !== consts.clientStatus.EXITING && client.client_status !== consts.clientStatus.DOWN) {
		if (client.managementAgentStatus === consts.managementAgentStatuses.DOWN)
			return 'Management Agent is down';

		const snapshotAttachmentExists = client.attachments && Object.values(client.attachments).some(a => 'snapshotStatus' in a);
		if (!client.isUmClient && snapshotAttachmentExists)
			return 'NVMesh User Mode is disabled while should be in use';
	}

	if (client.client_status === consts.clientStatus.INITIALIZING)
		return 'INITIALIZING';
	if (client.client_status === consts.clientStatus.PREP_RM)
		return 'STOPPING';
	if (client.client_status === consts.clientStatus.RM_RDY)
		return 'DEFUNCT';
	if (client.client_status === consts.clientStatus.EXITING || client.client_status === consts.clientStatus.DOWN)
		return 'OFFLINE';

	const now = new Date();
	const deltaLastModified = (now - new Date(client.dateModified)) / 1000;
	const hasIoDisabled = client.attachedBlockDevices?.some(bd => !bd.ioEnabled && !bd.is_hidden);

	if (deltaLastModified > 5 * 60)
		return 'More than 5 minutes since last communication';
	if (deltaLastModified > 2 * 60)
		return 'More than 2 minutes since last communication';
	if (hasIoDisabled)
		return 'Client has attachment with IO Disabled';
	else
		return 'OK';
};

const getVolumeAttachmentStatus = (client, volume) => {
	let volumeAttachmentStatus = {};

	const getLabelWithBackgroundColor = color => `label bg-${color}`;
	const redBgLabel = getLabelWithBackgroundColor('red');

	if (client.client_status == consts.clientStatus.DOWN) {
		volumeAttachmentStatus.class = redBgLabel;
		volumeAttachmentStatus.title = 'UNAVAILABLE';
		return volumeAttachmentStatus;
	}

	switch (volume.vol_status) {
		case consts.volumeAttachmentStatus.ATTACHED:
			volumeAttachmentStatus.class = getLabelWithBackgroundColor('green');
			volumeAttachmentStatus.title = 'ATTACHED';
			break;
		case consts.volumeAttachmentStatus.ATTACH_FAILED:
			volumeAttachmentStatus.class = redBgLabel;
			volumeAttachmentStatus.title = 'ATTACH FAILED';
			break;
		case consts.volumeAttachmentStatus.DETACH_FAILED:
			volumeAttachmentStatus.class = redBgLabel;
			volumeAttachmentStatus.title = 'DETACH FAILED';
			break;
		case consts.volumeAttachmentStatus.BUSY:
			volumeAttachmentStatus.class = redBgLabel;
			volumeAttachmentStatus.title = 'BUSY';
			break;
		default:
			volumeAttachmentStatus.class = getLabelWithBackgroundColor('yellow');
			volumeAttachmentStatus.title = '';
	}

	if (volume.is_hidden) {
		volumeAttachmentStatus.class = getLabelWithBackgroundColor('primary');
		volumeAttachmentStatus.title = (volumeAttachmentStatus.title ? volumeAttachmentStatus.title + ' - ' : '') + 'Recovery Attachment';

	} else if (!volume.ioEnabled) {
		volumeAttachmentStatus.class = redBgLabel;
		volumeAttachmentStatus.title = (volumeAttachmentStatus.title ? volumeAttachmentStatus.title + ' - ' : '') + 'IO Disabled';
	}

	return volumeAttachmentStatus;
};

const attachmentActionToCaption = action => {
	return {
		[consts.volumeAttachmentActions.ATTACHING]: 'ATTACHING',
		[consts.volumeAttachmentActions.DETACHING]: 'DETACHING',
		[consts.volumeAttachmentActions.UNAUTHORIZED]: 'UNAUTHORIZED'
	}[action];
};

const setClientActions = client => {
	const blockDevices = client.block_devices || [];
	const attachmentsWishfulState = client.attachments;
	const actions = [];

	if (!attachmentsWishfulState)
		return actions;

	const attachedBlockDevices = blockDevices
		.filter(bd => bd.vol_status === consts.volumeAttachmentStatus.ATTACHED)
		.map(bd => bd.name);

	const detachedBlockDevices = blockDevices
		.filter(bd => bd.vol_status === consts.volumeAttachmentStatus.DETACHED)
		.map(bd => bd.name);

	Object.values(attachmentsWishfulState).forEach(({ name, action }) => {
		const isAttaching = action === consts.volumeAttachmentActions.ATTACHING && !attachedBlockDevices.includes(name);
		const isDetaching = action === consts.volumeAttachmentActions.DETACHING
			&& (!detachedBlockDevices.includes(name) || blockDevices.some(bd => bd.name === name));
		const isUnauthorized = action === consts.volumeAttachmentActions.UNAUTHORIZED;

		if (isAttaching || isDetaching || isUnauthorized)
			actions.push({ name, action });
	});

	client.attachmentsActions = actions;
};

const getAttachmentActionStatus = attachment => {
	let attachmentActionStatus = {};

	switch (attachment.action) {
		case consts.volumeAttachmentActions.ATTACHING:
			attachmentActionStatus.class = 'label bg-green';
			attachmentActionStatus.title = 'ATTACHING';
			break;
		case consts.volumeAttachmentActions.DETACHING:
			attachmentActionStatus.class = 'label bg-red';
			attachmentActionStatus.title = 'DETACHING';
			break;
		case consts.volumeAttachmentActions.UNAUTHORIZED:
			attachmentActionStatus.class = 'label bg-yellow';
			attachmentActionStatus.title = 'UNAUTHORIZED';
			break;
		default:
			attachmentActionStatus.class = 'label bg-yellow';
			attachmentActionStatus.title = '';
	}

	return attachmentActionStatus;
};

const BlockDevicesToggle = ({ totalCount, isExpanded, toggleExpanded }) => {
	if (totalCount > consts.MAX_SHOW_UNEXPANDED_ATTACHMENTS)
		return (
			<a className="pull-left" onClick={toggleExpanded}>
				{isExpanded ? 'show less' : 'show more'}
			</a>
		);
};

const AttachmentsList = ({ items, getStatus, nameDisplay }) => {
	const [isExpanded, setIsExpanded] = useState(false);
	const aliasesToString = aliases => aliases && aliases.length ? ` [${aliases.join(', ')}]` : '';
	const displayedItems = isExpanded ? items : items.slice(0, consts.MAX_SHOW_UNEXPANDED_ATTACHMENTS);

	return (
		<>
			{displayedItems.map((item) => (
				<div key={item.uuid || item.name} className="pull-left mr-5">
					<span
						className={getStatus(item).class}
						title={getStatus(item).title}
					>
						{nameDisplay
							? nameDisplay(item)
							: <>
								{item.name}
								{item.aliases ? aliasesToString(item.aliases) : ''}
							  </>
						}
					</span>{' '}
				</div>
			))}
			<BlockDevicesToggle
				totalCount={items.length}
				isExpanded={isExpanded}
				toggleExpanded={() => setIsExpanded(!isExpanded)}
			/>
		</>
	);
};

const Clients = () => {
	const tableRef = useRef();
	const { currUser } = useAppContext();
	const { successAlert, errorAlert } = useAlerts();
	const [confirm] = useConfirmationDialog();
	const [selectedClients, setSelectedClients] = useState([]);
	const [showConfigProfileModal, setShowConfigProfileModal] = useState(false);
	const [showAttachDetachModal, setShowAttachDetachModal] = useState(false);

	useEffect(() => {
		const reloadTableInterval = setInterval(() => reloadTable(false), 3000);
		INTERVALS.push(reloadTableInterval);
		SocketService.addHandler(events.newClientEvent.name, reloadTable);
	}, []);

	const reloadTable = (deselectMissingRows = true) => {
		if (tableRef.current) {
			tableRef.current.reloadRows(deselectMissingRows);
			tableRef.current.reloadTotal();
		}
	};

	const columns = [
		{
			name: 'Client',
			title: 'Client ID',
			field: '_id',
			placeholder: 'Search by Client ID',
			sort: 'asc'
		},
		{
			name: 'Volume Attachments',
			field: 'attachedBlockDevices',
			filterable: false,
			value: client =>
				<AttachmentsList
					items={client.attachedBlockDevices}
					getStatus={item => getVolumeAttachmentStatus(client, item)}
				/>
		},
		{
			name: 'Attachments Actions',
			field: 'actions',
			filterable: false,
			value: client =>
				<AttachmentsList
					items={client.attachmentsActions}
					getStatus={item => getAttachmentActionStatus(item)}
					nameDisplay={attachment => <>{attachment.name}: {attachmentActionToCaption(attachment.action)}</>}
				/>
		},
		{
			name: 'Recovery Attachments',
			field: 'recoveryAttachments',
			filterable: false,
			value: client =>
				<AttachmentsList
					items={client.recoveryAttachments}
					getStatus={item => getVolumeAttachmentStatus(client, item)}
				/>
		},
		{
			name: 'Config Profile',
			field: 'configProfile.name',
			placeholder: 'Search by Profile',
			className: 'fixed-size-column lg-column',
			rowClassName: 'fixed-size-column',
			value: client => <>
				<ConfigProfileView
					configProfile={client.configProfile}
					desiredConfigProfile={client.configProfile?.desiredProfile}
					restartRequired={client.restartRequired} />
			</>
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
			value: client => <span className={getClientHealthIcon(client)} title={getClientStatus(client)}></span>
		}
	];

	const categorizeBlockDevices = client => {
		const [attachedBlockDevices, recoveryAttachments] = partition(
			(client.block_devices || []).filter(bdev => bdev.vol_status !== consts.volumeAttachmentStatus.DETACHED),
			bd => !bd.is_hidden
		);
		client.attachedBlockDevices = attachedBlockDevices;
		client.recoveryAttachments = recoveryAttachments;
	};

	const registerToEvents = client => {
		SocketService.addHandler(SocketService.getClientID(client.clientID) + events.clientFailureEvent.name, () => {
			reloadTable();
		});
		SocketService.addHandler(SocketService.getClientID(client.clientID) + events.clientWentOnlineEvent.name, ({ payload }) => {
			tableRef.current?.updateRow(payload.clientID, { ...client, health: payload.health });
		});
		SocketService.addHandler(SocketService.getClientID(client.clientID) + events.clientConfigProfileUpdated.name, ({ payload }) => {
			tableRef.current?.updateRow(payload.clientID, { ...client, configProfile: Object.assign(client.configProfile || {}, payload.profile) });
		});
		SocketService.addHandler(SocketService.getClientID(client.clientID) + events.restartRequiredChanged.name, ({ payload }) => {
			tableRef.current?.updateRow(payload.clientID, { ...client, restartRequired: payload.restartRequired });
		});
		SocketService.addHandler(SocketService.getNodeID(client.clientID) + events.configProfileUserOverrideChanged.name, ({ payload }) => {
			tableRef.current?.updateRow(payload.clientID, { ...client, configProfile: Object.assign(client.configProfile || {}, payload.profile) });
		});
	};

	const assignConfigProfile = async(clients) => {
		const nodesIDs = clients.map(client => client.clientID);
		const profiles = await ConfigurationProfilesService.getNodesConfigs({ _id: { $in: nodesIDs } });
		const clientsById = keyBy(clients, t => t.clientID);

		profiles.forEach((profile) => {
			const client = clientsById[profile._id];
			if (client) {
				client.configProfile = client.configProfile || {};
				Object.assign(client.configProfile, profile);
			}
		});
	};

	const loadRows = async(filter, sort, currentPage, count) => {
		const clients = await ClientsService.loadClients(filter, sort, currentPage, count);

		clients.forEach(client => {
			categorizeBlockDevices(client);
			registerToEvents(client);
			setClientActions(client);
		});

		await assignConfigProfile(clients);

		return clients;
	};

	const handleResponses = (responses, successMsg, failMsg) => {
		const responsesBySuccess = extractResults(responses);

		if (responsesBySuccess.success.length) {
			successAlert(`${responsesBySuccess.success.length} ${successMsg}`);
			reloadTable();
		}
		Object.keys(responsesBySuccess.failed).forEach(errorMsg => {
			const ids = responsesBySuccess.failed[errorMsg].map(entity => entity._id).join(', ');
			errorAlert(`${failMsg} ${ids} - ${errorMsg}`);
		});
	};

	const deleteClients = async() => {
		const isDeletedClientsConfirmed = await confirm(`Are you sure you want to delete ${selectedClients.length} client(s)?`);

		if (isDeletedClientsConfirmed) {
			const payload = selectedClients.map(({ _id, uuid }) => ({ _id: _id, uuid }));

			const responses = await ClientsService.delete(payload);
			handleResponses(responses, 'Client(s) deleted successfully', 'Failed to delete Clients');
		}
	};

	const onApplyProfile = async(profile) => {
		const nodeIDs = selectedClients.map(client => client._id);
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
	const createAttachDetachPayloads = (client, attachVolumes, detachVolumes) => {
		const clientIDs = {
			client: client.clientID,
			clientUUID: client.uuid
		};

		// Operation on multiple refIDs will create multiple volumes with the same name which must be sent in separate requests
		const groupVolumesByName = (volumes) => {
			const grouped = [{}];
			for (const volume of volumes) {
				const lastGroup = grouped[grouped.length - 1];
				if (!lastGroup[volume.name]) {
					lastGroup[volume.name] = volume;
				} else {
					grouped.push({ [volume.name]: volume });
				}
			}
			return grouped.map(group => Object.values(group));
		};

		const formatAttachPayload = (volumes) => ({
			...clientIDs,
			volumes: volumes.map(volume => ({
				name: volume.name,
				uuid: volume.uuid,
				reservation: {
					mode: volume.reservation.mode,
					preempt: volume.reservation.preempt || false,
					isDetachOthers: volume.reservation.isDetachOthers || false,
					...(volume.reservation.preempt && { version: volume.reservation.version })
				},
				...(client.isUmClient && { emulation: { mode: volume.emulation.mode } }),
				...(volume.referenceID && { referenceID: volume.referenceID })
			}))
		});

		const formatDetachPayload = (volumes) => ({
			...clientIDs,
			volumes
		});

		const attachPayloads = attachVolumes.length ? groupVolumesByName(attachVolumes).map(formatAttachPayload) : null;
		const detachPayloads = detachVolumes.length ? groupVolumesByName(detachVolumes).map(formatDetachPayload) : null;

		return { attachPayloads, detachPayloads };
	};

	const sendAttachDetachRequests = async({ attachPayloads, detachPayloads }) => {
		if (attachPayloads)
			attachPayloads.forEach(async(attachPayload) => {
				const responses = await ClientsService.attach(attachPayload);
				handleResponses(responses, 'Volumes(s) attached successfully', 'Failed to attach volumes');
			});

		if (detachPayloads)
			detachPayloads.forEach(async(detachPayload) => {
				const responses = await ClientsService.detach(detachPayload);
				handleResponses(responses, 'Volumes(s) detached successfully', 'Failed to detach volumes');
			});
	};

	const onAttachDetachCancel = () => {
		setShowAttachDetachModal(false);
	};

	const onAttachDetachSubmit = async({ attachments, detachments }) => {
		const payloads = createAttachDetachPayloads(selectedClients[0], attachments, detachments);
		await sendAttachDetachRequests(payloads);
		tableRef.current.reloadRows();
		setShowAttachDetachModal(false);
		tableRef.current.clearSelectedRows();
	};

	return (
		<div className="page-content">
			<ConfigurationProfileModal isOpen={showConfigProfileModal}
			                           nodeIDs={selectedClients.map(client => client._id)}
			                           handleCancel={() => setShowConfigProfileModal(false)}
			                           onSubmit={profile => onApplyProfile(profile)}/>

			{useMemo(() => <AttachDetachModal
				isOpen={showAttachDetachModal}
				client={selectedClients[0]}
				handleCancel={onAttachDetachCancel}
				onSubmit={onAttachDetachSubmit}
			/>, [showAttachDetachModal, selectedClients[0]?.clientID])}

			<h1>Clients</h1>

			<div className="action-container">
				<button className="btn multi-select-action-btn btn-info mgmt-btn-info"
				        disabled={
						 	!currUser.isAdmin ||
							!selectedClients.length ||
							selectedClients.some(client =>
								!(client.health === consts.targetHealth.CRITICAL &&
								[consts.clientStatus.DOWN, consts.clientStatus.INITIALIZING].includes(client.client_status)))
					}
				        onClick={() => deleteClients()}>
					Delete
				</button>
				<button className="btn multi-select-action-btn btn-info mgmt-btn-info"
				        disabled={!currUser.isAdmin || !selectedClients.length}
				        onClick={() => setShowConfigProfileModal(true)}>
					Configure
				</button>
				<button className="btn multi-select-action-btn btn-info mgmt-btn-info"
				        disabled={!currUser.isAdmin || selectedClients.length !== 1}
				        onClick={() => setShowAttachDetachModal(true)}>
					Attach/Detach
				</button>
			</div>

			<FiltSortTable ref={tableRef}
			               tableId="clients"
			               columns={columns}
			               loadTotal={ClientsService.loadTotal}
			               loadRows={loadRows}
			               multiselectOptions={{
				               enabled: true,
				               onSelectedRowsChange: selectedRows => {
					               setSelectedClients(selectedRows);
				               }
			               }}
			/>
		</div>
	);
};

export default Clients;
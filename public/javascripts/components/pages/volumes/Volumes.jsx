/*
 * SPDX-FileCopyrightText: Copyright (c) 2026 NVIDIA CORPORATION & AFFILIATES. All rights reserved.
 * SPDX-License-Identifier: Apache-2.0
 */

/* global React, INTERVALS, consts */

import FiltSortTable from '../../filtsort-table/FiltSortTable.jsx';
import { useAlerts } from '../../core/Alert.jsx';
import { useConfirmationDialog } from '../../shared/ConfirmationDialog.jsx';
import { VolumesService } from '../../services/api/volumes.service.js';
import { extractErrorMsg, extractResults } from '../../utils.js';
import NewButton from '../../shared/NewButton.jsx';
import CreateEditVolumeModal from './createEditModal/CreateEditVolumeModal.jsx';
import { useAppContext } from '../App.jsx';
import CapacityService from '../../services/capacity.service.js';
import { AllocationService } from '../../services/allocation.service.js';
import { DropdownButton, DropdownButtonItem } from '../../core/DropdownButton.jsx';
import PassphraseModal from './PassphraseModal.jsx';
import InitEncryptionModal from './InitEncryptionModal.jsx';
import { events, SocketService } from '../../services/socket.service.js';
import VolumeDiagramModal from './volumeDiagram/VolumeDiargramModal.jsx';
import { ellipsis } from '../../utils.js';
import useQueryParams from '../../useQueryParams.hook.js';

const { useRef, useState, useEffect, useMemo } = React;

const hiddenVolumeTypes = { [consts.RAIDLevel.JBOD]: true };

export const passphraseCommandToTitle = (commandName) => {
	const titles = {
		[consts.volumeEncryptionCommands.ADD_PASSPHRASE]: 'Add',
		[consts.volumeEncryptionCommands.ROTATE_PASSPHRASE]: 'Rotate',
		[consts.volumeEncryptionCommands.DELETE_PASSPHRASE]: 'Delete'
	};

	return titles[commandName] || commandName;
};

export const actionToClass = (action) => {
	if (action === consts.volumeActions.BOOTING) {
		return 'bg-red';
	}
	if (action === consts.volumeActions.REBUILDING) {
		return 'bg-yellow';
	}
	return 'bg-primary';
};

export const actionToCaption = (action) => {
	const captions = {
		[consts.volumeActions.EXTENDING]: 'Extending',
		[consts.volumeActions.MARKED_FOR_DELETION]: 'Marked For Deletion',
		[consts.volumeActions.DELETING]: 'Deleting',
		[consts.volumeActions.MARKED_FOR_REBUILD]: 'Marked For Rebuild',
		[consts.volumeActions.BOOTING]: 'Booting',
		[consts.volumeActions.REBUILD_REQUIRED]: 'Rebuild Required',
		[consts.volumeActions.REBUILDING]: 'Rebuilding',
		[consts.volumeActions.INITIALIZING]: 'Initializing',
		[consts.volumeActions.INIT_ENCRYPTION_REQUIRED]: 'Init Encryption Required',
		[consts.volumeActions.INITIALIZING_ENCRYPTION]: 'Initializing Encryption',
		[consts.volumeActions.ADDING_PASSPHRASE]: 'Adding Passphrase',
		[consts.volumeActions.DELETING_PASSPHRASE]: 'Deleting Passphrase',
		[consts.volumeActions.ROTATING_PASSPHRASE]: 'Rotating Passphrase'
	};

	return captions[action] || action;
};

export const statusToHealth = (status) => {
	switch (status) {
		case 'online':
			return 'green';
		case 'pendingDeletion':
			return 'primary';
		case 'degraded':
			return 'yellow';
		case 'unavailable':
		case 'offline':
			return 'red';
	}
};

export const statusToCaption = (status) => {
	const captions = {
		online: 'Online',
		rebuildFailed: 'Rebuild Failed',
		offline: 'Offline',
		degraded: 'Degraded',
		pendingDeletion: 'Pending Deletion',
		unavailable: 'Unavailable'
	};

	return captions[status] || status;
};

const isRebuildDisabled = (volume) => {
	const chunks = volume.chunks || [];

	return !chunks.some(chunk =>
		chunk.pRaids.some(pRaid =>
			pRaid.diskSegments.some(ds => ds.status === 'remap')
		)
	);
};

const BLOCKSET_TO_BYTES = 32 * 4000; // 32 * 4k Converting from blockset to bytes

function calculateDirtyBitsPercentage(volume, totalDirtyBits) {
	const dirtyBytes = totalDirtyBits * (BLOCKSET_TO_BYTES / consts.GB);
	const dataCapacity = getDataCapacity(volume);

	return 100 - Math.floor((dirtyBytes / dataCapacity) * 100);
}

function getDataCapacity(volume) {
	let dataCapacity = volume.capacity;
	if (volume.RAIDLevel === consts.RAIDLevel.ERASURE_CODING || volume.RAIDLevel === consts.RAIDLevel.STRIPED_ERASURE_CODING) {
		dataCapacity *= (volume.dataBlocks + volume.parityBlocks - 1) / volume.dataBlocks;
	}
	return dataCapacity;
}

function getSumOfDirtyBitsPerVolume(volume) {
	let totalDirtyBits = 0;

	// Consolidate all chunks, including metadata volume chunks if present.
	const allChunks = volume.mdv && volume.mdv.chunks ? [...volume.chunks, ...volume.mdv.chunks] : volume.chunks;

	// Calculate the sum of remaining dirty bits across all disk segments.
	allChunks.forEach(chunk => {
		chunk.pRaids.forEach(pRaid => {
			pRaid.diskSegments.forEach(segment => {
				totalDirtyBits += segment.remainingDirtyBits || 0;
			});
		});
	});

	return totalDirtyBits;
}

const Volumes = () => {
	const { unitType, currUser, generalSettings } = useAppContext();
	const { successAlert, errorAlert } = useAlerts();
	const [confirm] = useConfirmationDialog();
	const { getQueryParam, setQueryParam } = useQueryParams();
	const [selectedVolumes, setSelectedVolumes] = useState([]);
	const [showCreateEditModal, setShowCreateEditModal] = useState(false);
	const [diagramVolumeId, setDiagramVolumeId] = useState();
	const [volume, setVolume] = useState({});
	const tableRef = useRef();
	const isPassphraseCmdDisabled = selectedVolumes.some(v =>
		!v.isEncrypted ||
		!v.encryption.isInitialized ||
		v.encryption.command?.status && v.encryption.command?.status !== consts.encryptionCommandStatuses.EXECUTED);
	const [showPassphraseModal, setShowPassphraseModal] = useState(false);
	const [passphraseData, setPassphraseData] = useState({});
	const [passphraseCommandName, setPassphraseCommandName] = useState('');
	const [showInitEncryptionModal, setShowInitEncryptionModal] = useState(false);
	const [initData, setInitData] = useState({});
	const [showVolumeDiagramModal, setShowVolumeDiagramModal] = useState(false);

	useEffect(() => {
		const volumeId = getQueryParam('volume');
		if (volumeId) {
			openVolumeDiagramModal(volumeId);
		}
	}, []);

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
			placeholder: 'Search by Name',
			value: volume => <>
				<a onClick={() => openVolumeDiagramModal(volume._id)}>{volume.name}</a>
				{volume.isSnapshot && <i title="snapshot" className="fa fa-hdd-o"></i>}
				{volume.encryption?.command?.response?.error && !volume.encryption?.command?.response?.acknowledged &&
					<i className="fa fa-info-circle yellow" title={`Encryption Error: ${volume.encryption.command.response.error}`}></i>}
			</>
		},
		{
			name: 'Description',
			field: 'description',
			placeholder: 'Search by Description',
			value: volume => ellipsis(volume.description),
		},
		{
			name: 'Capacity',
			field: 'capacity',
			filterable: false,
			className: 'fixed-size-column sx-column',
			rowClassName: 'fixed-size-column',
			value: volume => {
				const capacity = volume.capacity === consts.volumeCapacity.MAX && volume.blocks && volume.blockSize ?
					volume.blocks * volume.blockSize :
					volume.capacity;
				return <>
					{CapacityService.toBiggestUnit(capacity, unitType)}
					{volume.volumeClass === consts.volumeClass.CDV && volume.cdvConfig && (
						<small className="text-muted"> ({volume.tpvCount || 0}/{volume.cdvConfig.maxTPVs} TPVs)</small>
					)}
				</>;
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
			value: volume => volume.dataBlocks || '1',
		},
		{
			name: 'Parity Blocks',
			field: 'parityBlocks',
			filterable: false,
			className: 'fixed-size-column sx-column',
			rowClassName: 'fixed-size-column',
			value: volume => {
				if (AllocationService.isMirrored(volume.RAIDLevel)) {
					return volume.numberOfMirrors;
				}
				if (AllocationService.isEC(volume.RAIDLevel)) {
					return volume.parityBlocks;
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
			name: 'Encrypted',
			field: 'isEncrypted',
			placeholder: 'Search by Encryption Status',
			className: 'fixed-size-column sx-column',
			rowClassName: 'fixed-size-column',
			type: 'boolean',
			value: volume => volume.isEncrypted && <i className="fa fa-lock"></i>,
		},
		{
			name: 'Action',
			field: 'action',
			className: 'fixed-size-column sx-column',
			rowClassName: 'fixed-size-column',
			sort: 'desc',
			value: volume => volume.action !== consts.volumeActions.NONE && (
				<label className={`label ${actionToClass(volume.action)}`}>
					{volume.action === 'rebuilding' || volume.action === 'deleting' && <span><i className="fa fa-cog fa-spin"></i>&nbsp;</span>}
					{actionToCaption(volume.action)}
					{volume.dirtyBitsPercentage && volume.action === 'rebuilding' && ` ${volume.dirtyBitsPercentage}%`}
					{volume.deletionZeroProgressPercentage && volume.action === 'deleting' && ` ${volume.deletionZeroProgressPercentage}%`}
				</label>),
		},
		{
			name: 'Status',
			field: 'status',
			className: 'fixed-size-column sx-column',
			rowClassName: 'fixed-size-column',
			value: volume => <label className={`label bg-${statusToHealth(volume.status)}`}>
				{statusToCaption(volume.status)}
				{volume.dirtyBitsPercentage && volume.status === 'rebuilding' && ` ${volume.dirtyBitsPercentage}%`}
				{volume.deletionZeroProgressPercentage && volume.status === 'deleting' && ` ${volume.deletionZeroProgressPercentage}%`}
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
			value: (volume) => (
				<a className="fa fa-pencil edit-button"
				   disabled={!currUser.isAdmin || volume.type === consts.volumeTypes.METADATA_VOLUME}
				   onClick={() => handleEditVolume(volume)}></a>
			),
		},
	];

	useEffect(() => {
		SocketService.addHandler(events.newVolumeEvent.name, () => reloadTable());
	}, []);

	// Show only regular volumes; CDVs have their own page, TPVs have their own page
	const getVolumeClassFilter = () => ({ volumeClass: { $in: [consts.volumeClass.REGULAR, null] } });

	const loadTotalFn = async(filter) => VolumesService.loadTotal({ ...filter, ...getVolumeClassFilter() });

	const loadRows = async(filter, sort, currentPage, count) => {
		const volumes = await VolumesService.loadVolumes({ ...filter, ...getVolumeClassFilter() }, sort, currentPage, count);
		volumes.forEach(volume => {
			if (volume.deletionZeroingStarted && volume.action === consts.volumeActions.MARKED_FOR_DELETION) {
				volume.action = consts.volumeActions.DELETING;
			}

			if (volume.status === consts.volumeStatuses.DEGRADED) {
				const totalDirtyBits = getSumOfDirtyBitsPerVolume(volume);
				if (!totalDirtyBits) return;

				volume.dirtyBitsPercentage = calculateDirtyBitsPercentage(volume, totalDirtyBits);
			}

			SocketService.addHandler((SocketService.getVolumeID(volume._id) + events.volumeRemovedEvent.name), () => reloadTable());

			SocketService.addHandler((SocketService.getVolumeID(volume._id) + events.volumeStatusChangeEvent.name),
				({ payload }) => {
					if (!payload) return;

					const toUpdate = {
						status: payload.status
					};
					if (volume.status === consts.volumeStatuses.ONLINE) {
						toUpdate.dirtyBitsPercentage = 0;
					}
					tableRef.current?.updateRow(payload._id, Object.assign(volume, toUpdate));
				});

			SocketService.addHandler((SocketService.getVolumeID(volume._id) + events.volumeActionChangeEvent.name),
				({ payload: { _id, action } }) => {
					tableRef.current?.updateRow(_id, Object.assign(volume, { action }));
				});

			SocketService.addHandler((SocketService.getVolumeID(volume._id) + events.dirtyBitsChangeEvent.name),
				({ payload }) => {
					if ((payload || !payload && payload === 0) && payload > -1 && volume.capacity > 0) {
						const dirtyBitsPercentage = calculateDirtyBitsPercentage(volume, payload);
						tableRef.current?.updateRow(payload._id, Object.assign(volume, { dirtyBitsPercentage }));
					}
				});

			SocketService.addHandler((SocketService.getVolumeID(volume._id) + events.volumeDeletionZeroingProgressChangeEvent.name),
				({ payload }) => {
					const toUpdate = {
						deletionZeroingStarted: true,
						deletionZeroProgressPercentage: payload.totalZeroedPercentage
					};

					if (volume.action === consts.volumeActions.MARKED_FOR_DELETION) {
						toUpdate.action = consts.volumeActions.DELETING;
					}
					tableRef.current?.updateRow(payload._id, Object.assign(volume, toUpdate));
				});
		});
		return volumes;
	};

	const openVolumeDiagramModal = (volumeId) => {
		setDiagramVolumeId(volumeId);
		setShowVolumeDiagramModal(true);
	};

	const handleVolumeDiagramModalClose = () => {
		setShowVolumeDiagramModal(false);
		setQueryParam('volume', null);
	};

	const handleEditVolume = (volume) => {
		setVolume(volume);
		setShowCreateEditModal(true);
	};

	const handleNewVolume = () => {
		const freshVolume = {
			capacity: 0,
			relativeRebuildPriority: 10,
			isEncrypted: false,
			isUsedAsSnapshot: false,
			isReadOnly: false,
			enableNVMf: generalSettings?.enableNVMf || false,
			serverClasses: [],
			diskClasses: [],
			VSGs: [],
			selectedClientsForNvmf: [],
		};

		setVolume(freshVolume);
		setShowCreateEditModal(true);
	};

	const createVolume = async(editedVolume) => {
		const responses = await VolumesService.create([editedVolume]);
		if (responses[0].success) {
			successAlert(`${editedVolume.name} Volume created successfully`);
			reloadTable();
		} else {
			const errorMsg = extractErrorMsg(responses[0].error);
			errorAlert(`Failed to create Volume ${editedVolume.name} - ${errorMsg}`);
		}
	};

	const updateVolume = async(editedVolume) => {
		if (editedVolume.capacity && editedVolume.capacity !== consts.volumeCapacity.NO_CHANGE) {
			return updateAndExtendVolume(editedVolume);
		}
		// eslint-disable-next-line no-unused-vars
		const { capacity, chunks, ...volumeToUpdate } = editedVolume;

		const responses = await VolumesService.update([volumeToUpdate]);
		if (responses[0].success) {
			successAlert(`Volume ${editedVolume._id} updated successfully`);
			reloadTable();
		} else {
			const errorMsg = extractErrorMsg(responses[0].error);
			errorAlert(`Failed to update Volume ${editedVolume._id} - ${errorMsg}`);
		}
	};

	const updateAndExtendVolume = async(editedVolume) => {
		const { _id, uuid } = editedVolume;
		// eslint-disable-next-line no-unused-vars
		const { capacity, chunks, ...volumeToUpdate } = editedVolume;

		const updateRes = await VolumesService.update([volumeToUpdate]);
		if (!updateRes[0].success) {
			const errorMsg = extractErrorMsg(updateRes[0].error);
			errorAlert(`Failed to update Volume ${editedVolume._id} - ${errorMsg}`);
			return;
		}

		const extendRes = await VolumesService.extend([{ _id, uuid, capacity }]);
		if (!extendRes[0].success) {
			const errorMsg = extractErrorMsg(extendRes[0].error);
			errorAlert(`Failed to extend Volume ${editedVolume._id} - ${errorMsg}`);
			return;
		}

		successAlert(`Volume ${editedVolume._id} updated and extended successfully`);
		reloadTable();
	};

	const handleSubmitVolume = async(editedVolume) => {
		const isCreate = !editedVolume._id;
		if (isCreate) {
			await createVolume(editedVolume);
		} else {
			await updateVolume(editedVolume);
		}
		setShowCreateEditModal(false);
		setVolume({});
	};

	const handleDeleteVolume = async() => {
		const deleteMsg = `Warning: You are about to delete ${selectedVolumes.length} logical volumes and any
        associated drive allocations to such volumes will be zeroed,
        making recovery of these volumes impossible. Are you sure you want to continue?`;

		const confirmed = await confirm(deleteMsg);
		if (!confirmed) {
			return;
		}

		const volumesToDelete = selectedVolumes.map(v => ({ _id: v._id, uuid: v.uuid }));
		const responses = await VolumesService.delete(volumesToDelete);

		const responsesBySuccess = extractResults(responses);

		if (responsesBySuccess.success.length) {
			successAlert(`${responsesBySuccess.success.length} Volume(s) deleted successfully`);
			reloadTable();
		}
		Object.keys(responsesBySuccess.failed).forEach(errorMsg => {
			const ids = responsesBySuccess.failed[errorMsg].map(entity => entity._id).join(', ');
			errorAlert(`Failed to delete Volume(s) ${ids} - ${errorMsg}`);
		});
	};

	const handleRebuildVolumes = async() => {
		const volumesToRebuild = selectedVolumes.map(v => ({ _id: v._id, uuid: v.uuid }));
		if (!volumesToRebuild.every(volume => volume.diskClasses?.length || volume.serverClasses?.length)) {
			const rebuildMsg = `Attention! Some volumes do not have any classes defined. Confirming will
            start the rebuild process using any available space. If this is not acceptable, click cancel below
            and then edit the volume in order to define a class.`;

			const confirmed = await confirm(rebuildMsg);
			if (!confirmed) {
				return;
			}
		}
		const confirmed = await confirm('Do you want to allocate on an offline hardware?', false, { confirmText: 'Yes', cancelText: 'No' });
		if (confirmed)
			volumesToRebuild.forEach(volume => volume.allowAllocationOnOfflineDrives = true);

		const responses = await VolumesService.rebuild(volumesToRebuild);

		const responsesBySuccess = extractResults(responses);

		if (responsesBySuccess.success.length) {
			successAlert(`${responsesBySuccess.success.length} Volume(s) rebuilt successfully`);
			reloadTable();
		}
		Object.keys(responsesBySuccess.failed).forEach(errorMsg => {
			const ids = responsesBySuccess.failed[errorMsg].map(entity => entity._id).join(', ');
			errorAlert(`Rebuild failed for Volume(s) ${ids} - ${errorMsg}`);
		});
	};

	// Init Encryption

	const handleInitEncryption = () => {
		setInitData({ slot: 1, keySize: consts.XTS_KEY_SIZES.XTS_AES_256 });
		setShowInitEncryptionModal(true);
	};

	const handleInitEncryptionSubmit = async(data) => {
		const payload = selectedVolumes.map(v => ({ _id: v._id, uuid: v.uuid, ...data, command: consts.volumeEncryptionCommands.INIT_ENCRYPTION }));

		const responses = await VolumesService.initEncryption(payload);

		const responsesBySuccess = extractResults(responses);

		if (responsesBySuccess.success.length) {
			successAlert(`${responsesBySuccess.success.length} Volume(s) Encryption initialized successfully`);
			reloadTable();
		}
		Object.keys(responsesBySuccess.failed).forEach(errorMsg => {
			const ids = responsesBySuccess.failed[errorMsg].map(entity => entity._id).join(', ');
			errorAlert(`Failed to initialize Encryption for Volume(s) ${ids} - ${errorMsg}`);
		});

		setShowInitEncryptionModal(false);
	};

	const handleInitEncryptionCancel = () => {
		setShowInitEncryptionModal(false);
	};

	// Passphrase

	const handleAddPassphrase = () => {
		setPassphraseCommandName(consts.volumeEncryptionCommands.ADD_PASSPHRASE);
		setPassphraseData({ slot: 1 });
		setShowPassphraseModal(true);
	};

	const handleRotatePassphrase = () => {
		setPassphraseCommandName(consts.volumeEncryptionCommands.ROTATE_PASSPHRASE);
		setPassphraseData({ slot: 1 });
		setShowPassphraseModal(true);
	};

	const handleDeletePassphrase = () => {
		setPassphraseCommandName(consts.volumeEncryptionCommands.DELETE_PASSPHRASE);
		setPassphraseData({});
		setShowPassphraseModal(true);
	};

	const handlePassphraseModalClose = () => {
		setShowPassphraseModal(false);
	};

	const handlePassphraseSubmit = async(data) => {
		const payload = selectedVolumes.map(v => ({ _id: v._id, uuid: v.uuid, ...data }));

		let responses;
		if (passphraseCommandName === consts.volumeEncryptionCommands.ADD_PASSPHRASE) {
			responses = await VolumesService.addPassphrase(payload);
		} else if (passphraseCommandName === consts.volumeEncryptionCommands.ROTATE_PASSPHRASE) {
			responses = await VolumesService.rotatePassphrase(payload);
		} else if (passphraseCommandName === consts.volumeEncryptionCommands.DELETE_PASSPHRASE) {
			responses = await VolumesService.deletePassphrase(payload);
		}
		const responsesBySuccess = extractResults(responses);

		if (responsesBySuccess.success.length) {
			successAlert(`${passphraseCommandToTitle(passphraseCommandName)} Passphrase for ${responsesBySuccess.success.length} Volume(s) successfully`);
			reloadTable();
		}
		Object.keys(responsesBySuccess.failed).forEach(errorMsg => {
			const ids = responsesBySuccess.failed[errorMsg].map(entity => entity._id).join(', ');
			errorAlert(`Failed to ${passphraseCommandToTitle(passphraseCommandName)} Passphrase for Volume(s) ${ids} - ${errorMsg}`);
		});

		setShowPassphraseModal(false);
	};

	const handleAckEncryptionError = async() => {
		const payload = selectedVolumes.map(v => ({ ...v, command: 'acknowledgeResponse' }));

		const responses = await VolumesService.acknowledgeEncryptionError(payload);

		const responsesBySuccess = extractResults(responses);

		if (responsesBySuccess.success.length) {
			successAlert(`${responsesBySuccess.success.length} Volume(s) Encryption error acknowledged successfully`);
			reloadTable();
		}
		Object.keys(responsesBySuccess.failed).forEach(errorMsg => {
			const ids = responsesBySuccess.failed[errorMsg].map(entity => entity._id).join(', ');
			errorAlert(`Failed to acknowledge Encryption Error for Volume(s) ${ids} - ${errorMsg}`);
		});
	};

	return (
		<div className="page-content">
			<PassphraseModal
				isOpen={showPassphraseModal}
				handleCancel={handlePassphraseModalClose}
				onSubmit={handlePassphraseSubmit}
				commandName={passphraseCommandName}
				passphraseData={passphraseData}
			/>

			<InitEncryptionModal
				isOpen={showInitEncryptionModal}
				handleCancel={handleInitEncryptionCancel}
				onSubmit={handleInitEncryptionSubmit}
				initData={initData}
			/>

			{useMemo(() => (
				<CreateEditVolumeModal
					isOpen={showCreateEditModal}
					volume={volume}
					handleCancel={() => {
						setShowCreateEditModal(false);
						setVolume({});
					}}
					onSubmit={handleSubmitVolume}
				/>
			), [showCreateEditModal, volume])}

			<VolumeDiagramModal
				isOpen={showVolumeDiagramModal}
				handleCancel={() => handleVolumeDiagramModalClose()}
				volumeId={diagramVolumeId}
			/>

			<h1>Volumes</h1>

			<div className="action-container" style={{ display: 'flex', alignItems: 'center' }}>
				<button className="btn multi-select-action-btn btn-info mgmt-btn-info"
				        disabled={!currUser.isAdmin || !selectedVolumes.length ||
					        selectedVolumes.some(volume => volume.type === consts.volumeTypes.METADATA_VOLUME)}
				        onClick={() => handleDeleteVolume()}>
					Delete
				</button>
				<button className="btn multi-select-action-btn btn-info mgmt-btn-info"
				        disabled={!currUser.isAdmin || !selectedVolumes.length || selectedVolumes.some(isRebuildDisabled)}
				        onClick={() => handleRebuildVolumes()}>
					Rebuild
				</button>
				<DropdownButton label="Encryption"
				                disabled={!currUser.isAdmin || !selectedVolumes.length || selectedVolumes.some(v => !v.isEncrypted)}>
					<DropdownButtonItem label="Init Encryption"
					                    onClick={() => handleInitEncryption()}
					                    disabled={selectedVolumes.some(v =>
						                    !v.isEncrypted ||
						                    v.encryption.isInitialized ||
						                    [consts.encryptionCommandStatuses.SENT,
							                    consts.encryptionCommandStatuses.PENDING_SEND].includes(v.encryption.command?.status)
					                    )}/>
					<DropdownButtonItem label="Add Passphrase"
					                    onClick={() => handleAddPassphrase()}
					                    disabled={isPassphraseCmdDisabled}/>
					<DropdownButtonItem label="Rotate Passphrase"
					                    onClick={() => handleRotatePassphrase()}
					                    disabled={isPassphraseCmdDisabled}/>
					<DropdownButtonItem label="Delete Passphrase"
					                    onClick={() => handleDeletePassphrase()}
					                    disabled={isPassphraseCmdDisabled}/>
					<DropdownButtonItem label="Acknowledge Error"
					                    onClick={() => handleAckEncryptionError()}
					                    disabled={selectedVolumes.some(v =>
						                    !v.isEncrypted ||
						                    !v.encryption.command?.response?.error ||
						                    !!v.encryption.command?.response?.acknowledged)}/>
				</DropdownButton>
			</div>

			<FiltSortTable
				ref={tableRef}
				tableId="volumes"
				columns={columns}
				loadTotal={loadTotalFn}
				loadRows={loadRows}
				multiselectOptions={{
					enabled: true,
					onSelectedRowsChange: setSelectedVolumes,
				}}
			/>

			<NewButton onClick={() => handleNewVolume()}
			           disabled={!currUser.isAdmin}/>

		</div>
	);
};

export default Volumes;
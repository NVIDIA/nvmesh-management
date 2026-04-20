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
import { useAppContext } from '../App.jsx';
import CapacityService from '../../services/capacity.service.js';
import { events, SocketService } from '../../services/socket.service.js';
import CreateTPVModal from './CreateTPVModal.jsx';
import InitEncryptionModal from '../volumes/InitEncryptionModal.jsx';
import PassphraseModal from '../volumes/PassphraseModal.jsx';
import { passphraseCommandToTitle } from '../volumes/Volumes.jsx';
import { DropdownButton, DropdownButtonItem } from '../../core/DropdownButton.jsx';

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
	const [showInitEncryptionModal, setShowInitEncryptionModal] = useState(false);
	const [initData, setInitData] = useState({});
	const [showPassphraseModal, setShowPassphraseModal] = useState(false);
	const [passphraseCommandName, setPassphraseCommandName] = useState('');
	const [passphraseData, setPassphraseData] = useState({});
	const tableRef = useRef();

	const isPassphraseCmdDisabled = selectedTPVs.some(v =>
		!v.isEncrypted ||
		!v.encryption?.isInitialized ||
		(v.encryption?.command?.status && v.encryption.command.status !== consts.encryptionCommandStatuses.EXECUTED));

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
			field: 'capacity',
			filterable: false,
			className: 'fixed-size-column sx-column',
			rowClassName: 'fixed-size-column',
			value: tpvRow => tpvRow.capacity != null
				? CapacityService.toBiggestUnit(tpvRow.capacity * consts.GiB, unitType, { fromBytes: true })
				: '—',
		},
		{
			name: 'Extent Size',
			field: 'tpvConfig.tpvExtentSizeKB',
			filterable: false,
			className: 'fixed-size-column sx-column',
			rowClassName: 'fixed-size-column',
			value: tpvRow => {
				const kb = tpvRow.tpvConfig?.tpvExtentSizeKB;
				if (kb == null) return '—';
				if (kb >= 1024 * 1024) return `${kb / (1024 * 1024)} GB`;
				if (kb >= 1024) return `${kb / 1024} MB`;
				return `${kb} KB`;
			},
		},
		{
			name: 'CDV Extents',
			filterable: false,
			sortable: false,
			className: 'fixed-size-column sx-column',
			rowClassName: 'fixed-size-column',
			value: tpvRow => tpvRow.runtimeStats?.cdvExtents != null
				? tpvRow.runtimeStats.cdvExtents
				: '—',
		},
		{
			name: 'TPV Extents In Use',
			filterable: false,
			sortable: false,
			className: 'fixed-size-column sx-column',
			rowClassName: 'fixed-size-column',
			value: tpvRow => {
				const stats = tpvRow.runtimeStats;
				if (!stats || stats.tpvExtentsInUse == null) return '—';
				return stats.tpvExtentsTotal != null
					? `${stats.tpvExtentsInUse} / ${stats.tpvExtentsTotal}`
					: stats.tpvExtentsInUse;
			},
		},
		{
			name: 'Client',
			field: 'tpvConfig.exclusiveClient',
			placeholder: 'Search by Client',
			value: tpvRow => {
				// Per-client CDV preempt badge (TPV_PerClientCDVPreemption.md Step 19b):
				// render a yellow "Evicting" tag while the TPV's exclusiveClient has
				// action === 'evicting' on the parent CDV. The server enriches TPV
				// documents with isEvicting via the $lookup used in calculateTPVCounters;
				// when the server-side enrichment isn't present on a given payload,
				// the check falls through to the plain client name.
				if (tpvRow.isEvicting) {
					return <>
						{tpvRow.tpvConfig?.exclusiveClient}
						{' '}
						<label className="label bg-yellow">Evicting</label>
					</>;
				}
				return tpvRow.tpvConfig?.exclusiveClient || <em>Detached</em>;
			},
		},
		{
			name: 'Encryption',
			field: 'isEncrypted',
			filterable: false,
			className: 'fixed-size-column sx-column',
			rowClassName: 'fixed-size-column',
			value: tpvRow => {
				if (!tpvRow.isEncrypted) return '—';
				const cmdStatus = tpvRow.encryption?.command?.status;
				const rsp = tpvRow.encryption?.command?.response;
				const isPending = cmdStatus === consts.encryptionCommandStatuses.SENT
					|| cmdStatus === consts.encryptionCommandStatuses.PENDING_SEND;
				if (!tpvRow.encryption?.isInitialized && !isPending)
					return <label className="label bg-yellow">Init Required</label>;
				if (isPending)
					return <label className="label bg-blue">In Progress</label>;
				if (rsp?.error && !rsp?.acknowledged)
					return <label className="label bg-red">Error</label>;
				return <label className="label bg-green">Encrypted</label>;
			},
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
			const newSizeGB = editedTPV.capacity;
			const sizeChanged = newSizeGB != null && newSizeGB !== tpv.capacity;

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

	const handleInitEncryption = () => {
		setInitData({ slot: 1, keySize: consts.XTS_KEY_SIZES.XTS_AES_256 });
		setShowInitEncryptionModal(true);
	};

	const handleInitEncryptionSubmit = async(data) => {
		const payload = selectedTPVs.map(v => ({ _id: v._id, uuid: v.uuid, ...data, command: consts.volumeEncryptionCommands.INIT_ENCRYPTION }));
		const responses = await VolumesService.initEncryption(payload);
		const byResult = extractResults(responses);
		if (byResult.success.length) {
			successAlert(`${byResult.success.length} TPV(s) Encryption initialized successfully`);
			reloadTable();
		}
		Object.keys(byResult.failed).forEach(errorMsg => {
			const ids = byResult.failed[errorMsg].map(e => e._id).join(', ');
			errorAlert(`Failed to initialize Encryption for TPV(s) ${ids} - ${errorMsg}`);
		});
		setShowInitEncryptionModal(false);
	};

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

	const handlePassphraseSubmit = async(data) => {
		const payload = selectedTPVs.map(v => ({ _id: v._id, uuid: v.uuid, ...data }));
		let responses;
		if (passphraseCommandName === consts.volumeEncryptionCommands.ADD_PASSPHRASE)
			responses = await VolumesService.addPassphrase(payload);
		else if (passphraseCommandName === consts.volumeEncryptionCommands.ROTATE_PASSPHRASE)
			responses = await VolumesService.rotatePassphrase(payload);
		else if (passphraseCommandName === consts.volumeEncryptionCommands.DELETE_PASSPHRASE)
			responses = await VolumesService.deletePassphrase(payload);
		const byResult = extractResults(responses);
		if (byResult.success.length) {
			successAlert(`${passphraseCommandToTitle(passphraseCommandName)} Passphrase for ${byResult.success.length} TPV(s) successfully`);
			reloadTable();
		}
		Object.keys(byResult.failed).forEach(errorMsg => {
			const ids = byResult.failed[errorMsg].map(e => e._id).join(', ');
			errorAlert(`Failed to ${passphraseCommandToTitle(passphraseCommandName)} Passphrase for TPV(s) ${ids} - ${errorMsg}`);
		});
		setShowPassphraseModal(false);
	};

	const handleAckEncryptionError = async() => {
		const payload = selectedTPVs.map(v => ({ ...v, command: 'acknowledgeResponse' }));
		const responses = await VolumesService.acknowledgeEncryptionError(payload);
		const byResult = extractResults(responses);
		if (byResult.success.length) {
			successAlert(`${byResult.success.length} TPV(s) Encryption error acknowledged successfully`);
			reloadTable();
		}
		Object.keys(byResult.failed).forEach(errorMsg => {
			const ids = byResult.failed[errorMsg].map(e => e._id).join(', ');
			errorAlert(`Failed to acknowledge Encryption Error for TPV(s) ${ids} - ${errorMsg}`);
		});
	};

	return (
		<div className="page-content">
			<PassphraseModal
				isOpen={showPassphraseModal}
				handleCancel={() => setShowPassphraseModal(false)}
				onSubmit={handlePassphraseSubmit}
				commandName={passphraseCommandName}
				passphraseData={passphraseData}
			/>
			<InitEncryptionModal
				isOpen={showInitEncryptionModal}
				handleCancel={() => setShowInitEncryptionModal(false)}
				onSubmit={handleInitEncryptionSubmit}
				initData={initData}
			/>
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

			<div className="action-container" style={{ display: 'flex', alignItems: 'center' }}>
				<button className="btn multi-select-action-btn btn-info mgmt-btn-info"
				        disabled={!currUser.isAdmin || !selectedTPVs.length}
				        onClick={handleDeleteTPVs}>
					Delete
				</button>
				<DropdownButton label="Encryption"
				                disabled={!currUser.isAdmin || !selectedTPVs.length || selectedTPVs.some(v => !v.isEncrypted)}>
					<DropdownButtonItem label="Init Encryption"
					                    onClick={() => handleInitEncryption()}
					                    disabled={selectedTPVs.some(v =>
						                    !v.isEncrypted ||
						                    v.encryption?.isInitialized ||
						                    [consts.encryptionCommandStatuses.SENT,
							                    consts.encryptionCommandStatuses.PENDING_SEND].includes(v.encryption?.command?.status)
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
					                    disabled={selectedTPVs.some(v =>
						                    !v.isEncrypted ||
						                    !v.encryption?.command?.response?.error ||
						                    !!v.encryption?.command?.response?.acknowledged)}/>
				</DropdownButton>
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

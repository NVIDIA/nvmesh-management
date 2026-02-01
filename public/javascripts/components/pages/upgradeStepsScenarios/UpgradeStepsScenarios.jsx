/*
 * SPDX-FileCopyrightText: Copyright (c) 2026 NVIDIA CORPORATION & AFFILIATES. All rights reserved.
 * SPDX-License-Identifier: Apache-2.0
 */

/* global React */

import FiltSortTable from '../../filtsort-table/FiltSortTable.jsx';
import { useAlerts } from '../../core/Alert.jsx';
import { useConfirmationDialog } from '../../shared/ConfirmationDialog.jsx';
import { UpgradeStepsScenariosService } from '../../services/api/upgradeStepsScenarios.service.js';
import { extractErrorMsg, extractResults } from '../../utils.js';
import NewButton from '../../shared/NewButton.jsx';
import CreateEditUpgradeStepScenarioModal from './CreateEditUpgradeStepScenarioModal.jsx';
import { events, SocketService } from '../../services/socket.service.js';

const {
	useState,
	useRef,
	useEffect
} = React;

const UpgradeStepsScenarios = () => {
	const tableRef = useRef();
	const { successAlert, errorAlert } = useAlerts();
	const [confirm] = useConfirmationDialog();
	const [selectedUpgradeStepsScenarios, setSelectedUpgradeStepsScenarios] = useState([]);
	const [showCreateEditModal, setShowCreateEditModal] = useState(false);
	const [upgradeStepScenario, setUpgradeStepScenario] = useState({});

	useEffect(() => {
		SocketService.addHandler(events.newUpgradeStepScenarioEvent.name, () => reloadTable());
	}, []);

	const columns = [
		{
			name: 'Name',
			field: 'name',
			placeholder: 'Search by Name',
			className: 'fixed-size-column lg-column'
		},
		{
			name: 'Command',
			field: 'command',
			placeholder: 'Search by Command',
			value: row => <code>{row.command}</code>
		},
		{
			name: 'Verification Command',
			field: 'verificationCommand',
			placeholder: 'Search by Verification Command',
			value: row => row.verificationCommand && <code>{row.verificationCommand}</code>
		},
		{
			name: 'Timeout',
			field: 'timeout',
			placeholder: 'Search by Timeout',
			className: 'fixed-size-column sx-column',
			rowClassName: 'fixed-size-column',
		},
		{
			name: 'Volume Affected',
			field: 'isVolumeAffected',
			type: 'boolean',
			className: 'fixed-size-column sx-column',
			rowClassName: 'fixed-size-column',
			value: row => row.isVolumeAffected !== 0 && <i className="ion-checkmark-round"></i>
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
				<a className="fa fa-pencil edit-button" onClick={() => editUpgradeStepScenario(row)}></a>
			),
		},
	];

	const reloadTable = () => {
		if (tableRef.current) {
			tableRef.current.reloadRows();
			tableRef.current.reloadTotal();
		}
	};

	const createUpgradeStepScenario = async(upgradeStepScenario) => {
		const responses = await UpgradeStepsScenariosService.create([upgradeStepScenario]);
		if (responses[0].success) {
			successAlert('Upgrade step scenario created successfully');
			reloadTable();
		} else {
			const errorMsg = extractErrorMsg(responses[0].error);
			errorAlert(`Failed to create upgrade step scenario - ${errorMsg}`);
		}
	};

	const updateUpgradeStepScenario = async(upgradeStepScenario) => {
		const responses = await UpgradeStepsScenariosService.update([upgradeStepScenario]);
		if (responses[0].success) {
			successAlert('Upgrade step scenario updated successfully');
			reloadTable();
		} else {
			const errorMsg = extractErrorMsg(responses[0].error);
			errorAlert(`Failed to update upgrade step scenario - ${errorMsg}`);
		}
	};

	const deleteUpgradeStepsScenarios = async() => {
		const confirmed = await confirm(`Are you sure you want to delete ${selectedUpgradeStepsScenarios.length} upgrade step scenario(s)?`);
		if (!confirmed) {
			return;
		}

		const payload = selectedUpgradeStepsScenarios.map(upgradeStepScenario => ({ ID: upgradeStepScenario.ID }));

		const responses = await UpgradeStepsScenariosService.delete(payload);
		const responsesBySuccess = extractResults(responses);

		if (responsesBySuccess.success.length) {
			successAlert(`${responsesBySuccess.success.length} upgrade step scenario(s) deleted successfully`);
			reloadTable();
		}
		Object.keys(responsesBySuccess.failed).forEach(errorMsg => {
			const ids = responsesBySuccess.failed[errorMsg].map(entity => entity.ID).join(', ');
			errorAlert(`Failed to delete upgrade step scenario(s) ${ids} - ${errorMsg}`);
		});
	};

	const editUpgradeStepScenario = (upgradeStepScenario) => {
		setUpgradeStepScenario(upgradeStepScenario);
		setShowCreateEditModal(true);
	};

	const newUpgradeStepScenario = (initialUpgradeStepScenario = { isVolumeAffected: 0 }) => {
		setUpgradeStepScenario(initialUpgradeStepScenario);
		setShowCreateEditModal(true);
	};

	const onCancelCreateEditUpgradeStepScenario = () => {
		setShowCreateEditModal(false);
	};

	const onSubmitUpgradeStepScenario = async(editedUpgradeStepScenario) => {
		const isCreate = !editedUpgradeStepScenario.ID;
		if (isCreate) {
			await createUpgradeStepScenario(editedUpgradeStepScenario);
		} else {
			await updateUpgradeStepScenario(editedUpgradeStepScenario);
		}
		setShowCreateEditModal(false);
	};

	const loadRows = async(filter, sort, currentPage, count) => {
		const upgradeStepsScenarios = await UpgradeStepsScenariosService.loadUpgradeStepsScenarios(filter, sort, currentPage, count);
		upgradeStepsScenarios.forEach(upgradeStepScenario => {
			SocketService.addHandler(SocketService.getUpgradeStepScenarioID(upgradeStepScenario.ID) + events.upgradeStepScenarioChangedEvent.name,
				() => reloadTable());
			SocketService.addHandler(SocketService.getUpgradeStepScenarioID(upgradeStepScenario.ID) + events.upgradeStepScenarioRemovedEvent.name,
				() => reloadTable());
		});
		return upgradeStepsScenarios;
	};

	return (
		<div className="page-content">
			<CreateEditUpgradeStepScenarioModal isOpen={showCreateEditModal}
			                                    upgradeStepScenario={upgradeStepScenario}
			                                    handleCancel={() => onCancelCreateEditUpgradeStepScenario()}
			                                    onSubmit={upgradeStepScenario => onSubmitUpgradeStepScenario(upgradeStepScenario)}/>
			<h1>Upgrade Steps Scenarios</h1>

			<div className="action-container">
				<button className="btn btn-info mgmt-btn-info"
				        disabled={!selectedUpgradeStepsScenarios.length}
				        onClick={() => deleteUpgradeStepsScenarios()}>
					Delete
				</button>
			</div>

			<FiltSortTable
				ref={tableRef}
				rowIdentifier="ID"
				tableId="upgradeStepsScenarios"
				columns={columns}
				loadTotal={UpgradeStepsScenariosService.loadTotal}
				loadRows={loadRows}
				multiselectOptions={{
					enabled: true,
					onSelectedRowsChange: selectedRows => setSelectedUpgradeStepsScenarios(selectedRows)
				}}
			/>

			<NewButton onClick={() => newUpgradeStepScenario()}/>
		</div>
	);
};

export default UpgradeStepsScenarios;

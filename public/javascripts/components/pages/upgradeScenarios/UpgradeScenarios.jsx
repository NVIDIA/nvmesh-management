/*
 * SPDX-FileCopyrightText: Copyright (c) 2026 NVIDIA CORPORATION & AFFILIATES. All rights reserved.
 * SPDX-License-Identifier: Apache-2.0
 */

/* global React */

import FiltSortTable from '../../filtsort-table/FiltSortTable.jsx';
import { useAlerts } from '../../core/Alert.jsx';
import { useConfirmationDialog } from '../../shared/ConfirmationDialog.jsx';
import { UpgradeScenariosService } from '../../services/api/upgradeScenarios.service.js';
import { extractErrorMsg, extractResults } from '../../utils.js';
import NewButton from '../../shared/NewButton.jsx';
import CreateEditUpgradeScenarioModal from './CreateEditUpgradeScenarioModal.jsx';
import ExpandableList from '../../core/ExpandableList.jsx';
import { events, SocketService } from '../../services/socket.service.js';
import { debounce } from '../../utils.js';

const {
	useState,
	useRef,
	useEffect,
	useCallback
} = React;

const reloadTableDebounceInterval = 300;

const UpgradeScenarios = () => {
	const tableRef = useRef();
	const { successAlert, errorAlert } = useAlerts();
	const [confirm] = useConfirmationDialog();
	const [selectedUpgradeScenarios, setSelectedUpgradeScenarios] = useState([]);

	const [showCreateEditModal, setShowCreateEditModal] = useState(false);
	const [upgradeScenario, setUpgradeScenario] = useState({});

	useEffect(() => {
		SocketService.addHandler(events.newUpgradeScenarioEvent.name, () => reloadTable());
	}, []);

	const columns = [
		{
			name: 'Source Version',
			field: 'componentVersion.version',
			placeholder: 'Search by Source Version',
			className: 'fixed-size-column md-column'
		},
		{
			name: 'Destination Version',
			field: 'release.version',
			placeholder: 'Search by Destination Version',
			className: 'fixed-size-column md-column'
		},
		{
			name: 'Upgrade Type',
			field: 'upgradeType.name',
			placeholder: 'Search by Upgrade Type',
			className: 'fixed-size-column md-column'
		},
		{
			name: 'Steps',
			field: 'steps',
			filterable: false,
			sortable: false,
			value: row => <ExpandableList
				items={row.steps}
				maxItems={6}
				renderItem={(step, index) => <span key={index} className="label label-info">{step.name}</span>}/>,
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
				<a className="fa fa-pencil edit-button" onClick={() => editUpgradeScenario(row)}></a>
			),
		},
	];

	const reloadTable = useCallback(debounce(() => {
		if (tableRef.current) {
			tableRef.current.reloadRows();
			tableRef.current.reloadTotal();
		}
	}, reloadTableDebounceInterval), []);

	const createUpgradeScenario = async(upgradeScenario) => {
		const responses = await UpgradeScenariosService.create([upgradeScenario]);
		if (responses[0].success) {
			successAlert('Upgrade scenario created successfully');
			reloadTable();
		} else {
			const errorMsg = extractErrorMsg(responses[0].error);
			errorAlert(`Failed to create upgrade scenario - ${errorMsg}`);
		}
	};

	const updateUpgradeScenario = async(upgradeScenario) => {
		const responses = await UpgradeScenariosService.update([upgradeScenario]);
		if (responses[0].success) {
			successAlert('Upgrade scenario updated successfully');
			reloadTable();
		} else {
			const errorMsg = extractErrorMsg(responses[0].error);
			errorAlert(`Failed to update upgrade scenario - ${errorMsg}`);
		}
	};

	const deleteUpgradeScenarios = async() => {
		const confirmed = await confirm(`Are you sure you want to delete ${selectedUpgradeScenarios.length} upgrade scenario(s)?`);
		if (!confirmed) {
			return;
		}

		const payload = selectedUpgradeScenarios.map(upgrade => ({ ID: upgrade.ID }));

		const responses = await UpgradeScenariosService.delete(payload);
		const responsesBySuccess = extractResults(responses);

		if (responsesBySuccess.success.length) {
			successAlert(`${responsesBySuccess.success.length} upgrade scenario(s) deleted successfully`);
			reloadTable();
		}
		Object.keys(responsesBySuccess.failed).forEach(errorMsg => {
			const ids = responsesBySuccess.failed[errorMsg].map(entity => entity.ID).join(', ');
			errorAlert(`Failed to delete upgrade scenario(s) ${ids} - ${errorMsg}`);
		});
	};

	const editUpgradeScenario = (upgradeScenario) => {
		setUpgradeScenario(upgradeScenario);
		setShowCreateEditModal(true);
	};

	const newUpgradeScenario = (initialUpgradeScenario = {}) => {
		setUpgradeScenario(initialUpgradeScenario);
		setShowCreateEditModal(true);
	};

	const onCancelCreateEditUpgradeScenario = () => {
		setShowCreateEditModal(false);
	};

	const onSubmitUpgradeScenario = async(editedUpgradeScenario) => {
		const isCreate = !editedUpgradeScenario.ID;
		if (isCreate) {
			await createUpgradeScenario(editedUpgradeScenario);
		} else {
			await updateUpgradeScenario(editedUpgradeScenario);
		}
		setShowCreateEditModal(false);
	};

	const loadRows = async(filter, sort, currentPage, count) => {
		const upgradeScenarios = await UpgradeScenariosService.loadUpgradeScenarios(filter, sort, currentPage, count);
		upgradeScenarios.forEach(upgradeScenario => {
			SocketService.addHandler(SocketService.getUpgradeScenarioID(upgradeScenario.ID) + events.upgradeScenarioChangedEvent.name, () => reloadTable());
			SocketService.addHandler(SocketService.getUpgradeScenarioID(upgradeScenario.ID) + events.upgradeScenarioRemovedEvent.name, () => reloadTable());
		});
		return upgradeScenarios;
	};

	return (
		<div className="page-content">
			<CreateEditUpgradeScenarioModal isOpen={showCreateEditModal}
			                                upgradeScenario={upgradeScenario}
			                                handleCancel={() => onCancelCreateEditUpgradeScenario()}
			                                onSubmit={upgradeScenario => onSubmitUpgradeScenario(upgradeScenario)}/>
			<h1>Upgrade Scenarios</h1>

			<div className="action-container">
				<button className="btn btn-info mgmt-btn-info"
				        disabled={selectedUpgradeScenarios.length === 0}
				        onClick={() => deleteUpgradeScenarios()}>
					Delete
				</button>
			</div>

			<FiltSortTable
				ref={tableRef}
				rowIdentifier="ID"
				tableId="upgradeScenarios"
				columns={columns}
				loadTotal={UpgradeScenariosService.loadTotal}
				loadRows={loadRows}
				multiselectOptions={{
					enabled: true,
					onSelectedRowsChange: selectedRows => setSelectedUpgradeScenarios(selectedRows)
				}}
			/>

			<NewButton onClick={() => newUpgradeScenario()}/>
		</div>
	);
};

export default UpgradeScenarios;

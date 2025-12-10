/* global React, consts */

import FiltSortTable from '../../filtsort-table/FiltSortTable.jsx';
import { useAlerts } from '../../core/Alert.jsx';
import { useConfirmationDialog } from '../../shared/ConfirmationDialog.jsx';
import { UpgradesService } from '../../services/api/upgrades.service.js';
import { extractErrorMsg, extractResults } from '../../utils.js';
import useQueryParams from '../../useQueryParams.hook.js';
import NewButton from '../../shared/NewButton.jsx';
import CreateUpgradeModal from './CreateUpgradeModal.jsx';
import { SocketService, events } from '../../services/socket.service.js';
import { UpgradeStepsService } from '../../services/api/upgradeSteps.service.js';
import UpgradeStatus from '../upgrade/UpgradeStatus.jsx';
import ExpandableList from '../../core/ExpandableList.jsx';

const {
	useState,
	useRef,
	useEffect
} = React;

const executionModeToLabel = (executionMode) => {
	switch (executionMode) {
		case consts.upgradeExecutionModes.AUTOMATIC:
			return 'Automatic';
		case consts.upgradeExecutionModes.MANUAL_START:
			return 'Manual Start';
		case consts.upgradeExecutionModes.MANUAL:
			return 'Manual';
		default:
			return executionMode;
	}
};

const minRedundancyLevelToLabel = (minRedundancyLevel) => {
	switch (minRedundancyLevel) {
		case consts.upgradeRedundancyLevels.MINIMAL:
			return 'Minimal';
		case consts.upgradeRedundancyLevels.MAX:
			return 'Maximal';
		default:
			return minRedundancyLevel;
	}
};

const Upgrades = () => {
	const tableRef = useRef();
	const { successAlert, errorAlert } = useAlerts();
	const [confirm] = useConfirmationDialog();
	const { getQueryParam, setQueryParam } = useQueryParams();
	const [selectedUpgrades, setSelectedUpgrades] = useState([]);

	const [showCreateModal, setShowCreateModal] = useState(false);
	const [upgrade, setUpgrade] = useState({});

	useEffect(() => {
		const createParam = getQueryParam('create');
		if (createParam) {
			openModal(createParam);
		}

		SocketService.addHandler(events.upgradeStatusChangedEvent.name, ({ payload }) => {
			tableRef.current?.updateRow(payload._id, { status: payload.status });
		});
	}, []);

	const openModal = (initialUpgrade = {}) => {
		const freshUpgrade = {
			minRedundancyLevel: consts.upgradeRedundancyLevels.MAX,
			executionMode: consts.upgradeExecutionModes.AUTOMATIC,
			...initialUpgrade
		};
		setShowCreateModal(true);
		setUpgrade(freshUpgrade);
	};

	const columns = [{
		name: 'UUID',
		field: '_id',
		placeholder: 'Search by UUID',
		className: 'fixed-size-column md-column',
		hiddenByDefault: true
	}, {
		name: 'Destination',
		field: 'destinationVersion',
		placeholder: 'Search by Destination Version',
		className: 'fixed-size-column md-column',
		value: row => <a href={`/upgrades/upgrade/${row._id}`}>{row.destinationVersion}</a>
	}, {
		name: 'Execution Mode',
		field: 'executionMode',
		placeholder: 'Search by Execution Mode',
		className: 'fixed-size-column md-column',
		value: row => executionModeToLabel(row.executionMode)
	}, {
		name: 'Redundancy Level',
		field: 'minRedundancyLevel',
		placeholder: 'Search by Min Redundancy Level',
		className: 'fixed-size-column md-column',
		value: row => minRedundancyLevelToLabel(row.minRedundancyLevel)
	}, {
		name: 'Machines',
		field: 'machinesToUpgrade._id',
		placeholder: 'Search by Machines',
		value: row => <ExpandableList
			items={row.machinesToUpgrade}
			renderItem={(node) => <span key={node.hostname} className="label label-info">{node.hostname}</span>}
		/>
	}, {
		name: 'Status',
		field: 'status',
		placeholder: 'Search by Status',
		className: 'fixed-size-column md-column',
		rowClassName: 'fixed-size-column',
		value: row => <UpgradeStatus upgrade={row}/>
	}, {
		name: 'Last Modified By',
		field: 'modifiedBy',
		placeholder: 'Search by Last Modifier',
		className: 'fixed-size-column md-column'
	}, {
		name: 'Date Modified',
		field: 'dateModified',
		placeholder: 'Search by Date Modified',
		type: 'dateRange',
		className: 'fixed-size-column md-column',
	}, {
		name: 'Date Created',
		field: 'dateCreated',
		placeholder: 'Search by Date Created',
		type: 'dateRange',
		className: 'fixed-size-column md-column',
		hiddenByDefault: true
	}, {
		name: 'Created By',
		field: 'createdBy',
		placeholder: 'Search by Created By',
		className: 'fixed-size-column md-column',
		hiddenByDefault: true
	}];

	async function updateCompletedSteps(row) {
		const completedSteps = await UpgradeStepsService.loadTotalByUpgrade(row._id, { 
			status: { $in: consts.completedUpgradeStepStatuses }
		});

		if (!row.completedSteps || completedSteps > row.completedSteps)
			tableRef.current?.updateRow(row._id, { completedSteps });
	}

	const loadRows = async(filter, sort, currentPage, count) => {
		const rows = await UpgradesService.loadUpgrades(filter, sort, currentPage, count);

		rows.forEach(row => {
			if (row.status === consts.upgradeStatuses.IN_PROGRESS || row.status === consts.upgradeStatuses.PAUSED) {
				updateCompletedSteps(row);
			}

			SocketService.addHandler(SocketService.getUpgradeID(row._id) + events.upgradeStatusChangedEvent.name, ({ payload }) => {
				tableRef.current?.updateRow(payload._id, { ...row, status: payload.status });
			});

			SocketService.addHandler(SocketService.getUpgradeID(row._id) + events.upgradeRemovedEvent.name, () => reloadTable());

			SocketService.addHandler(SocketService.getUpgradeID(row._id) + events.upgradeStepStatusChangedEvent.name, () => {
				updateCompletedSteps(row);
			});
		});

		return rows;
	};

	const reloadTable = () => {
		if (tableRef.current) {
			tableRef.current.reloadRows();
			tableRef.current.reloadTotal();
		}
	};

	const onCancelCreateUpgrade = () => {
		setShowCreateModal(false);
		setUpgrade({});
		setQueryParam('create', null);
	};

	const createUpgrade = async(upgrade) => {
		const responses = await UpgradesService.create(upgrade);

		if (responses[0].success) {
			successAlert(`${upgrade.destinationVersion} Upgrade created successfully`);
			reloadTable();
		} else {
			const errorMsg = extractErrorMsg(responses[0].error);
			errorAlert(`Failed to create Upgrade ${upgrade.destinationVersion} - ${errorMsg}`);
		}
	};

	const updateUpgrade = async(upgrade) => {
		const responses = await UpgradesService.update([upgrade]);
		if (responses[0].success) {
			successAlert(`${upgrade._id} Upgrade updated successfully`);
			reloadTable();
		} else {
			const errorMsg = extractErrorMsg(responses[0].error);
			errorAlert(`Failed to updated Upgrade ${upgrade._id} - ${errorMsg}`);
		}
	};

	const resumeUpgrade = async() => {
		const upgrade = selectedUpgrades[0];
		const responses = await UpgradesService.resumeUpgrade(upgrade);

		if (responses[0].success) {
			successAlert(`${upgrade._id} Upgrade resumed successfully`);
			reloadTable();
		} else {
			const errorMsg = extractErrorMsg(responses[0].error);
			errorAlert(`Failed to resume Upgrade ${upgrade._id} - ${errorMsg}`);
		}
	};

	const startUpgrade = async() => {
		const upgrade = selectedUpgrades[0];
		const responses = await UpgradesService.startUpgrade(upgrade);

		if (responses[0].success) {
			successAlert(`${upgrade._id} Upgrade started successfully`);
			reloadTable();
		} else {
			const errorMsg = extractErrorMsg(responses[0].error);
			errorAlert(`Failed to start Upgrade ${upgrade._id} - ${errorMsg}`);
		}
	};

	const deleteUpgrades = async() => {
		const confirmed = await confirm(`Are you sure you want to delete ${selectedUpgrades.length} upgrades?`);

		if (!confirmed) return;

		const payload = selectedUpgrades.map(({ _id, uuid }) => ({ _id, uuid }));

		const responses = await UpgradesService.delete(payload);
		const responsesBySuccess = extractResults(responses);

		if (responsesBySuccess.success.length) {
			successAlert(`${responsesBySuccess.success.length} Upgrades deleted successfully`);
			reloadTable();
		}
		Object.keys(responsesBySuccess.failed).forEach(errorMsg => {
			const ids = responsesBySuccess.failed[errorMsg].map(entity => entity._id).join(', ');
			errorAlert(`Failed to delete Upgrades ${ids} - ${errorMsg}`);
		});
	};

	const onSubmitUpgrade = async(editedUpgrade) => {
		const isCreate = !editedUpgrade._id;

		if (isCreate) {
			await createUpgrade(editedUpgrade);
		} else {
			await updateUpgrade(editedUpgrade);
		}

		onCancelCreateUpgrade();
	};

	return (
		<div className="page-content">
			<h1>Upgrades</h1>

			<CreateUpgradeModal isOpen={showCreateModal}
			                    upgrade={upgrade}
			                    handleCancel={() => onCancelCreateUpgrade()}
			                    onSubmit={upgrade => onSubmitUpgrade(upgrade)}/>

			<div className="action-container">
				<button
					className="btn multi-select-action-btn btn-info mgmt-btn-info"
					disabled={selectedUpgrades.length === 0}
					onClick={() => deleteUpgrades()}
				>
					Delete
				</button>
				<button
					className="btn multi-select-action-btn btn-info mgmt-btn-info"
					disabled={selectedUpgrades.length !== 1 || selectedUpgrades[0].status !== consts.upgradeStatuses.PENDING_START}
					onClick={() => startUpgrade()}
				>
					Start
				</button>
				<button
					className="btn multi-select-action-btn btn-info mgmt-btn-info"
					disabled={selectedUpgrades.length !== 1 || selectedUpgrades[0].status !== consts.upgradeStatuses.PAUSED}
					onClick={() => resumeUpgrade()}
				>
					Resume
				</button>
			</div>

			<FiltSortTable
				ref={tableRef}
				tableId="upgrades"
				columns={columns}
				loadTotal={UpgradesService.loadTotal}
				loadRows={loadRows}
				multiselectOptions={{
					enabled: true,
					onSelectedRowsChange: selectedRows => {
						setSelectedUpgrades(selectedRows);
					}
				}}
			/>

			<NewButton onClick={() => openModal()}/>
		</div>
	);
};

export default Upgrades;
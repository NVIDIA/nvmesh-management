/* global React */

import { useAlerts } from '../../core/Alert.jsx';
import CreateEditOperatingSystemModal from './CreateEditOperatingSystemModal.jsx';
import { useConfirmationDialog } from '../../shared/ConfirmationDialog.jsx';
import { OperatingSystemsService } from '../../services/api/operatingSystems.service.js';
import { extractErrorMsg, extractResults } from '../../utils.js';
import NewButton from '../../shared/NewButton.jsx';
import OperatingSystemsFiltSortTable from './OperatingSystemsFiltSortTable.jsx';

const { useState, useRef } = React;

const OperatingSystems = () => {
	const tableRef = useRef();
	const { successAlert, errorAlert } = useAlerts();
	const [confirm] = useConfirmationDialog();
	const [selectedOperatingSystems, setSelectedOperatingSystems] = useState([]);
	const [showCreateEditModal, setShowCreateEditModal] = useState(false);
	const [operatingSystem, setOperatingSystem] = useState({});

	const reloadTable = () => {
		if (tableRef.current) {
			tableRef.current.reloadRows();
			tableRef.current.reloadTotal();
		}
	};

	const createOperatingSystem = async(operatingSystem) => {
		const payload = {
			version: operatingSystem.version,
			distributionTypeID: operatingSystem.distributionType.ID
		};
		const responses = await OperatingSystemsService.create([payload]);
		if (responses[0].success) {
			successAlert(`${operatingSystem.distributionType.name} ${operatingSystem.version} Operating System created successfully`);
			reloadTable();
		} else {
			const errorMsg = extractErrorMsg(responses[0].error);
			errorAlert(`Failed to create Operating System ${operatingSystem.distributionType.name} ${operatingSystem.version} - ${errorMsg}`);
		}
	};

	const updateOperatingSystem = async(operatingSystem) => {
		const payload = {
			ID: operatingSystem.ID,
			version: operatingSystem.version,
			distributionTypeID: operatingSystem.distributionType.ID
		};
		const responses = await OperatingSystemsService.update([payload]);
		if (responses[0].success) {
			successAlert(`${operatingSystem.distributionType.name} ${operatingSystem.version} Operating System updated successfully`);
			reloadTable();
		} else {
			const errorMsg = extractErrorMsg(responses[0].error);
			errorAlert(`Failed to update Operating System ${operatingSystem.distributionType.name} ${operatingSystem.version} - ${errorMsg}`);
		}
	};

	const deleteOperatingSystems = async() => {
		const confirmed = await confirm(`Are you sure you want to delete ${selectedOperatingSystems.length} Operating Systems?`);
		if (!confirmed) {
			return;
		}

		const payload = selectedOperatingSystems.map(({ ID, version }) => ({ ID, version }));
		const responses = await OperatingSystemsService.delete(payload);
		const responsesBySuccess = extractResults(responses);

		if (responsesBySuccess.success.length) {
			successAlert(`${responsesBySuccess.success.length} Operating Systems deleted successfully`);
			reloadTable();
		}
		Object.keys(responsesBySuccess.failed).forEach(errorMsg => {
			const ids = responsesBySuccess.failed[errorMsg].map(entity => entity._id).join(', ');
			errorAlert(`Failed to delete Operating Systems ${ids} - ${errorMsg}`);
		});
	};

	const editOperatingSystem = (operatingSystem) => {
		setShowCreateEditModal(true);
		setOperatingSystem(operatingSystem);
	};

	const newOperatingSystem = (initialOperatingSystem = {}) => {
		setShowCreateEditModal(true);
		setOperatingSystem(initialOperatingSystem);
	};

	const onCancelCreateEditOperatingSystem = () => {
		setShowCreateEditModal(false);
		setOperatingSystem({});
	};

	const onSubmitOperatingSystem = async(editedOperatingSystem) => {
		const isCreate = !editedOperatingSystem.ID;
		if (isCreate) {
			await createOperatingSystem(editedOperatingSystem);
		} else {
			await updateOperatingSystem(editedOperatingSystem);
		}
		setShowCreateEditModal(false);
		setOperatingSystem({});
	};

	return (
		<div className="page-content">
			<CreateEditOperatingSystemModal
				isOpen={showCreateEditModal}
				operatingSystem={operatingSystem}
				handleCancel={() => onCancelCreateEditOperatingSystem()}
				onSubmit={operatingSystem => onSubmitOperatingSystem(operatingSystem)}
			/>

			<h1>Operating Systems</h1>

			<div className="action-container">
				<button
					className="btn btn-info mgmt-btn-info"
					disabled={selectedOperatingSystems.length === 0}
					onClick={deleteOperatingSystems}>
					Delete
				</button>
			</div>

			<OperatingSystemsFiltSortTable
				ref={tableRef}
				tableId="operatingSystems"
				onEditOperatingSystem={editOperatingSystem}
				multiselectOptions={{
					enabled: true,
					onSelectedRowsChange: setSelectedOperatingSystems
				}}
			/>

			<NewButton onClick={() => newOperatingSystem()} />
		</div>
	);
};

export default OperatingSystems;
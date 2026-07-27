/* global React */

import { useAlerts } from '../../core/Alert.jsx';
import CreateEditOfedModal from './CreateEditOfedModal.jsx';
import { useConfirmationDialog } from '../../shared/ConfirmationDialog.jsx';
import { OfedsService } from '../../services/api/ofeds.service.js';
import { extractErrorMsg, extractResults } from '../../utils.js';
import NewButton from '../../shared/NewButton.jsx';
import OfedsFiltSortTable from './OfedsFiltSortTable.jsx';

const { useState, useRef } = React;

const Ofeds = () => {
	const tableRef = useRef();
	const { successAlert, errorAlert } = useAlerts();
	const [confirm] = useConfirmationDialog();
	const [selectedOfeds, setSelectedOfeds] = useState([]);
	const [showCreateEditModal, setShowCreateEditModal] = useState(false);
	const [ofed, setOfed] = useState({});

	const reloadTable = () => {
		if (tableRef.current) {
			tableRef.current.reloadRows();
			tableRef.current.reloadTotal();
		}
	};

	const createOfed = async(ofed) => {
		const responses = await OfedsService.create([ofed.version]);
		if (responses[0].success) {
			successAlert(`${ofed.version} Ofed created successfully`);
			reloadTable();
		} else {
			const errorMsg = extractErrorMsg(responses[0].error);
			errorAlert(`Failed to create Ofed ${ofed.version} - ${errorMsg}`);
		}
	};

	const updateOfed = async(ofed) => {
		const responses = await OfedsService.update([ofed]);
		if (responses[0].success) {
			successAlert(`${ofed.version} Ofed updated successfully`);
			reloadTable();
		} else {
			const errorMsg = extractErrorMsg(responses[0].error);
			errorAlert(`Failed to update Ofed ${ofed.version} - ${errorMsg}`);
		}
	};

	const deleteOfeds = async() => {
		const confirmed = await confirm(`Are you sure you want to delete ${selectedOfeds.length} ofeds?`);
		if (!confirmed) {
			return;
		}

		const payload = selectedOfeds.map(({ ID, version }) => ({ ID, version }));

		const responses = await OfedsService.delete(payload);
		const responsesBySuccess = extractResults(responses);

		if (responsesBySuccess.success.length) {
			successAlert(`${responsesBySuccess.success.length} Ofeds deleted successfully`);
			reloadTable();
		}
		Object.keys(responsesBySuccess.failed).forEach(errorMsg => {
			const ids = responsesBySuccess.failed[errorMsg].map(entity => entity._id).join(', ');
			errorAlert(`Failed to delete Ofeds ${ids} - ${errorMsg}`);
		});
	};

	const editOfed = (ofed) => {
		setShowCreateEditModal(true);
		setOfed(ofed);
	};

	const newOfed = (initialOfed = {}) => {
		setShowCreateEditModal(true);
		setOfed(initialOfed);
	};

	const onCancelCreateEditOfed = () => {
		setShowCreateEditModal(false);
		setOfed({});
	};

	const onSubmitOfed = async(editedOfed) => {
		const isCreate = !editedOfed.ID;
		if (isCreate) {
			await createOfed(editedOfed);
		} else {
			await updateOfed(editedOfed);
		}
		setShowCreateEditModal(false);
		setOfed({});
	};

	return (
		<div className="page-content">
			<CreateEditOfedModal
				isOpen={showCreateEditModal}
				ofed={ofed}
				handleCancel={() => onCancelCreateEditOfed()}
				onSubmit={ofed => onSubmitOfed(ofed)}
			/>

			<h1>Ofeds</h1>

			<div className="action-container">
				<button
					className="btn btn-info mgmt-btn-info"
					disabled={selectedOfeds.length === 0}
					onClick={deleteOfeds}>
					Delete
				</button>
			</div>

			<OfedsFiltSortTable
				ref={tableRef}
				tableId="ofeds"
				onEditOfed={editOfed}
				multiselectOptions={{
					enabled: true,
					onSelectedRowsChange: setSelectedOfeds
				}}
			/>

			<NewButton onClick={() => newOfed()} />
		</div>
	);
};

export default Ofeds;
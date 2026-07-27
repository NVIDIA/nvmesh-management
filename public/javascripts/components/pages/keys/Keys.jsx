/* global React */

import { useAlerts } from '../../core/Alert.jsx';
import CreateEditKeyModal from './CreateEditKeyModal.jsx';
import { useConfirmationDialog } from '../../shared/ConfirmationDialog.jsx';
import { KeysService } from '../../services/api/keys.service.js';
import { extractErrorMsg, extractResults } from '../../utils.js';
import NewButton from '../../shared/NewButton.jsx';
import KeysFiltSortTable from './KeysFiltSortTable.jsx';

const { useState, useRef } = React;

const Keys = () => {
	const tableRef = useRef();
	const { successAlert, errorAlert } = useAlerts();
	const [confirm] = useConfirmationDialog();
	const [selectedKeys, setSelectedKeys] = useState([]);
	const [showCreateEditModal, setShowCreateEditModal] = useState(false);
	const [key, setKey] = useState({});

	const reloadTable = () => {
		if (tableRef.current) {
			tableRef.current.reloadRows();
			tableRef.current.reloadTotal();
		}
	};

	const createKey = async(key) => {
		const responses = await KeysService.create([key]);
		if (responses[0].success) {
			successAlert(`${key._id} Key Pair created successfully`);
			reloadTable();
		} else {
			const errorMsg = extractErrorMsg(responses[0].error);
			errorAlert(`Failed to create Key Pair ${key._id} - ${errorMsg}`);
		}
	};

	const updateKey = async(key) => {
		const responses = await KeysService.update([key]);
		if (responses[0].success) {
			successAlert(`${key._id} Key Pair updated successfully`);
			reloadTable();
		} else {
			const errorMsg = extractErrorMsg(responses[0].error);
			errorAlert(`Failed to update Key Pair ${key._id} - ${errorMsg}`);
		}
	};

	const deleteKeys = async() => {
		const confirmed = await confirm(`Are you sure you want to delete ${selectedKeys.length} key pairs?`);
		if (!confirmed) {
			return;
		}

		const payload = selectedKeys.map(({ _id, uuid }) => ({ _id, uuid }));

		const responses = await KeysService.delete(payload);
		const responsesBySuccess = extractResults(responses);

		if (responsesBySuccess.success.length) {
			successAlert(`${responsesBySuccess.success.length} Key Pairs deleted successfully`);
			reloadTable();
		}
		Object.keys(responsesBySuccess.failed).forEach(errorMsg => {
			const ids = responsesBySuccess.failed[errorMsg].map(entity => entity._id).join(', ');
			errorAlert(`Failed to delete Key Pairs ${ids} - ${errorMsg}`);
		});
	};

	const editKey = (key) => {
		setShowCreateEditModal(true);
		setKey(key);
	};

	const newKey = (initialKey = {}) => {
		setShowCreateEditModal(true);
		setKey(initialKey);
	};

	const onCancelCreateEditKey = () => {
		setShowCreateEditModal(false);
		setKey({});
	};

	const onSubmitKey = async(editedKey) => {
		const isCreate = !editedKey.uuid;
		if (isCreate) {
			await createKey(editedKey);
		} else {
			await updateKey(editedKey);
		}
		setShowCreateEditModal(false);
		setKey({});
	};

	const downloadFile = (filename, text) => {
		const element = document.createElement('a');
		element.href = `data:text/plain;charset=utf-8,${encodeURIComponent(text)}`;
		element.download = filename;
		document.body.appendChild(element);
		element.click();
		document.body.removeChild(element);
	};

	const downloadKey = (key) => {
		const keyToDownload = JSON.stringify({ name: key._id, uuid: key.uuid, dbUUID: key.dbUUID });
		const fileName = `${key._id}.key`;
		downloadFile(fileName, keyToDownload);
	};

	return (
		<div className="page-content">
			<CreateEditKeyModal
				isOpen={showCreateEditModal}
				keyPair={key}
				handleCancel={() => onCancelCreateEditKey()}
				onSubmit={key => onSubmitKey(key)} 
			/>

			<h1>Key Pairs</h1>

			<div className="action-container">
				<button
					className="btn btn-info mgmt-btn-info"
					disabled={selectedKeys.length === 0}
					onClick={deleteKeys}>
					Delete
				</button>
			</div>

			<div className="action-container">
				<button 
					className="btn btn-info mgmt-btn-info"
					disabled={selectedKeys.length !== 1}
					onClick={() => downloadKey(selectedKeys[0])}>
					Download Key
				</button>
			</div>

			<KeysFiltSortTable
				ref={tableRef}
				tableId="keys"
				onEditKey={editKey}
				multiselectOptions={{
					enabled: true,
					onSelectedRowsChange: setSelectedKeys
				}}
			/>

			<NewButton onClick={() => newKey()} />
		</div>
	);
};

export default Keys;
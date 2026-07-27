/* global React, ReactHookForm */

import Input from '../../core/Input.jsx';
import FormControl from '../../core/FormControl.jsx';
import Modal from '../../core/Modal.jsx';
import KeysFiltSortTable from '../keys/KeysFiltSortTable.jsx';
import CreateEditKeyModal from '../keys/CreateEditKeyModal.jsx';
import { KeysService } from '../../services/api/keys.service.js';
import { extractErrorMsg } from '../../utils.js';
import { useAlerts } from '../../core/Alert.jsx';

const { useForm } = ReactHookForm;
const { useRef, useState } = React;

const CreateEditVolumeSecurityGroup = ({
	volumeSecurityGroup = {},
	handleCancel = () => {},
	onSubmit = () => {}
}) => {
	const keysTableRef = useRef();
	const { register, handleSubmit, formState } = useForm({ mode: 'all' });
	const { successAlert, errorAlert } = useAlerts();
	const [selectedKeys, setSelectedKeys] = useState(volumeSecurityGroup?.keys?.map(key => ({ _id: key })) || []);
	const [showCreateEditKeyModal, setShowCreateEditKeyModal] = useState(false);
	const [key, setKey] = useState({});
	const isCreate = !volumeSecurityGroup.uuid;

	const onFormSubmit = (data) => {
		const editedVolumeSecurityGroup = {
			...volumeSecurityGroup,
			...data,
			keys: selectedKeys.map(key => key._id)
		};
		onSubmit(editedVolumeSecurityGroup);
	};

	const reloadTable = () => {
		if (keysTableRef.current) {
			keysTableRef.current.reloadRows();
			keysTableRef.current.reloadTotal();
		}
	};

	const editKey = (key) => {
		setShowCreateEditKeyModal(true);
		setKey(key);
	};

	const onCancelCreateEditKey = () => {
		setShowCreateEditKeyModal(false);
		setKey({});
	};

	const onSubmitKey = async(editedKey) => {
		await updateKey(editedKey);
		setShowCreateEditKeyModal(false);
		setKey({});
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

	return (
		<>
			<CreateEditKeyModal
				isOpen={showCreateEditKeyModal}
				keyPair={key}
				handleCancel={onCancelCreateEditKey}
				onSubmit={key => onSubmitKey(key)}
			/>

			<div className="modal-body">
				<FormControl
					name="_id"
					label="Name"
					required
					errorMessage={formState.errors?._id?.message}>
					<Input
						name="_id"
						className="form-control"
						disabled={!isCreate}
						placeholder="Enter name"
						{...register('_id', {
							value: volumeSecurityGroup._id,
							required: 'Name is required',
							pattern: { value: /^[\w-]+$/, message: 'Invalid name' },
							maxLength: { value: 1024, message: 'exceed maximum length of 1024' }
						})}
						autoFocus
						required
					/>
				</FormControl>

				<FormControl
					name="description"
					label="Description"
					errorMessage={formState.errors?.description?.message}>
					<Input
						name="description"
						className="form-control"
						placeholder="Enter description"
						{...register('description', {
							value: volumeSecurityGroup.description,
							maxLength: { value: 1024, message: 'exceed maximum length of 1024' }
						})}
					/>
				</FormControl>

				<KeysFiltSortTable
					ref={keysTableRef}
					tableId="volumeSecurityGroupsKeys"
					onEditKey={editKey}
					multiselectOptions={{
						enabled: true,
						initiallySelectedRows: selectedKeys,
						onSelectedRowsChange: setSelectedKeys,
						isViewSelectedEnabled: true
					}}
				/>
			</div>

			<div className="modal-footer">
				<button
					className="btn btn-primary mgmt-btn-primary"
					onClick={handleSubmit(onFormSubmit)}
					disabled={!formState.isValid}>
					{isCreate ? 'Add' : 'Update'}
				</button>
				<button
					className="btn btn-default"
					onClick={() => handleCancel()}>
					Cancel
				</button>
			</div>
		</>
	);
};

const CreateEditVolumeSecurityGroupModal = ({
	isOpen,
	volumeSecurityGroup = {},
	handleCancel = () => {},
	onSubmit = () => {}
}) => {

	return (
		<Modal
			isOpen={isOpen}
			disableBackdropClose
			onClose={handleCancel}
			title="Volume Security Group"
			className="modal-lg">
			<CreateEditVolumeSecurityGroup
				volumeSecurityGroup={volumeSecurityGroup}
				handleCancel={handleCancel}
				onSubmit={onSubmit} />
		</Modal>
	);
};

export default CreateEditVolumeSecurityGroupModal;
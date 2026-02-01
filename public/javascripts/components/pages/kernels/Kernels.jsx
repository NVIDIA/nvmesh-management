/*
 * SPDX-FileCopyrightText: Copyright (c) 2026 NVIDIA CORPORATION & AFFILIATES. All rights reserved.
 * SPDX-License-Identifier: Apache-2.0
 */

/* global React */

import { useAlerts } from '../../core/Alert.jsx';
import CreateEditKernelModal from './CreateEditKernelModal.jsx';
import { useConfirmationDialog } from '../../shared/ConfirmationDialog.jsx';
import { KernelsService } from '../../services/api/kernels.service.js';
import { extractErrorMsg, extractResults } from '../../utils.js';
import NewButton from '../../shared/NewButton.jsx';
import KernelsFiltSortTable from './KernelsFiltSortTable.jsx';

const { useState, useRef } = React;

const Kernels = () => {
	const tableRef = useRef();
	const { successAlert, errorAlert } = useAlerts();
	const [confirm] = useConfirmationDialog();
	const [selectedKernels, setSelectedKernels] = useState([]);
	const [showCreateEditModal, setShowCreateEditModal] = useState(false);
	const [kernel, setKernel] = useState({});

	const reloadTable = () => {
		if (tableRef.current) {
			tableRef.current.reloadRows();
			tableRef.current.reloadTotal();
		}
	};

	const createKernel = async(kernel) => {
		const responses = await KernelsService.create([kernel.version]);
		if (responses[0].success) {
			successAlert(`${kernel.version} Kernel created successfully`);
			reloadTable();
		} else {
			const errorMsg = extractErrorMsg(responses[0].error);
			errorAlert(`Failed to create Kernel ${kernel.version} - ${errorMsg}`);
		}
	};

	const updateKernel = async(kernel) => {
		const responses = await KernelsService.update([kernel]);
		if (responses[0].success) {
			successAlert(`${kernel.version} Kernel updated successfully`);
			reloadTable();
		} else {
			const errorMsg = extractErrorMsg(responses[0].error);
			errorAlert(`Failed to update Kernel ${kernel.version} - ${errorMsg}`);
		}
	};

	const deleteKernels = async() => {
		const confirmed = await confirm(`Are you sure you want to delete ${selectedKernels.length} kernels?`);
		if (!confirmed) {
			return;
		}

		const payload = selectedKernels.map(({ ID, version }) => ({ ID, version }));

		const responses = await KernelsService.delete(payload);
		const responsesBySuccess = extractResults(responses);

		if (responsesBySuccess.success.length) {
			successAlert(`${responsesBySuccess.success.length} Kernels deleted successfully`);
			reloadTable();
		}
		Object.keys(responsesBySuccess.failed).forEach(errorMsg => {
			const ids = responsesBySuccess.failed[errorMsg].map(entity => entity._id).join(', ');
			errorAlert(`Failed to delete Kernels ${ids} - ${errorMsg}`);
		});
	};

	const editKernel = (kernel) => {
		setShowCreateEditModal(true);
		setKernel(kernel);
	};

	const newKernel = (initialKernel = {}) => {
		setShowCreateEditModal(true);
		setKernel(initialKernel);
	};

	const onCancelCreateEditKernel = () => {
		setShowCreateEditModal(false);
		setKernel({});
	};

	const onSubmitKernel = async(editedKernel) => {
		const isCreate = !editedKernel.ID;
		if (isCreate) {
			await createKernel(editedKernel);
		} else {
			await updateKernel(editedKernel);
		}
		setShowCreateEditModal(false);
		setKernel({});
	};

	return (
		<div className="page-content">
			<CreateEditKernelModal
				isOpen={showCreateEditModal}
				kernel={kernel}
				handleCancel={() => onCancelCreateEditKernel()}
				onSubmit={kernel => onSubmitKernel(kernel)}
			/>

			<h1>Kernels</h1>

			<div className="action-container">
				<button
					className="btn btn-info mgmt-btn-info"
					disabled={selectedKernels.length === 0}
					onClick={deleteKernels}>
					Delete
				</button>
			</div>

			<KernelsFiltSortTable
				ref={tableRef}
				tableId="kernels"
				onEditKernel={editKernel}
				multiselectOptions={{
					enabled: true,
					onSelectedRowsChange: setSelectedKernels
				}}
			/>

			<NewButton onClick={() => newKernel()} />
		</div>
	);
};

export default Kernels;
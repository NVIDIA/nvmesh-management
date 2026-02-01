/*
 * SPDX-FileCopyrightText: Copyright (c) 2026 NVIDIA CORPORATION & AFFILIATES. All rights reserved.
 * SPDX-License-Identifier: Apache-2.0
 */

/* global React, ReactHookForm */

import Input from '../../core/Input.jsx';
import FiltSortTable from '../../filtsort-table/FiltSortTable.jsx';
import DomainsSelect from '../../shared/DomainsSelect.jsx';
import FormControl from '../../core/FormControl.jsx';
import Modal from '../../core/Modal.jsx';
import { DisksService } from '../../services/api/disks.service.js';
import { DiskUtilsService } from '../../services/disk-utils.service.js';
import DriveHealthIcon from '../drives/DriveHealthIcon.jsx';
import DriveEvictedIcon from '../drives/DrivesEvictedIcon.jsx';
import CapacityDisplay from '../drives/CapacityDisplay.jsx';
import CapacityService from '../../services/capacity.service.js';
import { useAppContext } from '../App.jsx';

const { useState, useRef } = React;
const { useForm } = ReactHookForm;

const CreateEditDriveClass = ({

	isEditMode = false,
	driveClass = {},
	handleCancel = () => {},
	domains = [],
	// eslint-disable-next-line no-unused-vars
	onSubmit = _ => {}
}) => {
	const { unitType } = useAppContext();
	const [selectedDrives, setSelectedDrives] = useState(driveClass.disks?.map(drive => ({ disks: { ...drive, _id: drive.diskID } })) || []);
	const [selectedDomains, setSelectedDomains] = useState(driveClass.domains);
	const { register, handleSubmit, formState } = useForm({ mode: 'all' });
	const tableRef = useRef(null);

	const columns = [
		{
			name: 'Target',
			field: 'disks.nodeID',
			placeholder: 'Search by Drive ID',
			sort: 'asc',
			className: 'fixed-size-column md-column',
			value: row => <a href={`/servers/server/${row.disks.nodeID}`}>{row.disks.nodeID}</a>,
		},
		{
			name: 'SN',
			field: 'disks.Serial_Number',
			filterable: true,
			sortable: true,
			className: 'fixed-size-column sx-column',
			rowClassName: 'fixed-size-column',
		},
		{
			name: 'Vendor',
			field: 'disks.Vendor',
			filterable: true,
			sortable: true,
			className: 'fixed-size-column sx-column',
			rowClassName: 'fixed-size-column',
		},
		{
			name: 'Model',
			field: 'disks.Model',
			placeholder: 'Search by Version',
			className: 'fixed-size-column md-column',
			value: row => DiskUtilsService.modelToDisplayString(row.disks.Model)
		},
		{
			name: 'Block Size',
			field: 'disks.block_size',
			filterable: true,
			sortable: true,
			className: 'fixed-size-column sx-column',
			rowClassName: 'fixed-size-column',
			value: row => CapacityService.toBiggestUnit(row.disks.block_size, unitType, { fromBytes: true, trunc: true })
		},
		{
			name: 'Metadata Size',
			field: 'disks.metadata_size',
			filterable: true,
			sortable: true,
			className: 'fixed-size-column sx-column',
			rowClassName: 'fixed-size-column',
			value: row => CapacityService.toBiggestUnit(row.disks.metadata_size, unitType, { fromBytes: true, trunc: true })
		},
		{
			name: 'Capacity',
			field: 'disks.usableBlocks',
			placeholder: 'Search by Capacity',
			className: 'fixed-size-column md-column',
			value: row => <CapacityDisplay disk={row.disks} />
		},
		{
			name: 'Health',
			field: 'disks.health',
			filterable: true,
			sortable: true,
			placeholder: 'Search by Health',
			className: 'fixed-size-column sx-column',
			value: row => <div className='fixed-size-column servers-health'><DriveHealthIcon drive={row.disks} /></div>
		},
		{
			name: 'Evicted',
			field: 'disks.isOutOfService',
			filterable: true,
			sortable: true,
			placeholder: 'Search by Health',
			className: 'fixed-size-column sx-column',
			value: row => <DriveEvictedIcon drive={row.disks} />
		}
	];

	const getDrivesTableFilter = () => {
		const allowedDrives = {
			'disks.isOutOfService': { '$ne': true },
			'disks.isExcluded': { '$ne': true },
			'disks.status': { '$nin': ['Not_Initialized', 'Missing'] }
		};

		if (!isEditMode)
			// in creation mode, show only allowed Drives
			return allowedDrives;

		return {};
	};

	const loadFilteredDrives = async(filter, sort, currentPage, count) => {
		const fixedFilter = getDrivesTableFilter();
		const mergedFilter = Object.assign({}, fixedFilter, filter || {});
		const drives = await DisksService.load(mergedFilter, sort, currentPage, count);
		return drives;
	};

	const loadTotalFilteredDrives = async(filter) => {
		const fixedFilter = getDrivesTableFilter();
		const mergedFilter = Object.assign({}, fixedFilter, filter || {});
		const total = await DisksService.loadTotal(mergedFilter);
		return total;
	};

	const onFormSubmit = (data) => {
		const editedDriveClass = {
			...driveClass,
			...data,
			disks: selectedDrives.map(row => ({
				diskID: row.disks.diskID,
				node_id: row.disks.nodeID || row.disks.node_id,
				model: row.disks.Model || row.disks.model
			})),
			domains: selectedDomains
		};
		onSubmit(editedDriveClass);
	};

	return (
		<>
			<div className="modal-body modal-xl">
				<FormControl name="_id"
				             label="Name"
				             required
				             errorMessage={formState.errors?._id?.message}>
					<Input name="_id"
					       className="form-control"
					       disabled={isEditMode}
					       placeholder="Enter name"
					       {...register('_id', {
						       value: driveClass._id,
						       required: 'Name is required',
						       pattern: { value: /^[\w-]+$/, message: 'Invalid name' },
						       maxLength: { value: 1024, message: 'exceed maximum length of 1024' }
					       })}
					       autoFocus
					       required
					/>
				</FormControl>

				<FormControl name="description"
				             label="Description"
				             errorMessage={formState.errors?.description?.message}>
					<Input name="description"
					       className="form-control"
					       placeholder="Enter description"
					       {...register('description', {
						       value: driveClass.description,
						       maxLength: { value: 1024, message: 'exceed maximum length of 1024' }
					       })}
					/>
				</FormControl>

				<DomainsSelect domains={domains}
				               selectedDomains={selectedDomains}
				               onChange={setSelectedDomains}
				/>

				{selectedDrives.length === 0 && <div><span> Select at least 1 drive <i className="ion ion-alert-circled red"></i></span></div>}
				<FiltSortTable
					ref={tableRef}
					tableId="driveClassesDrives"
					rowIdentifier='disks.diskID'
					columns={columns}
					loadTotal={loadTotalFilteredDrives}
					loadRows={loadFilteredDrives}
					queryParamsEnabled={false}
					tableSettingsCache={{
						enabled: false,
					}}
					multiselectOptions={{
						enabled: true,
						initiallySelectedRows: selectedDrives,
						onSelectedRowsChange: setSelectedDrives,
						isViewSelectedEnabled: true
					}}
				/>
			</div>
			<div className="modal-footer">
				<button className="btn btn-primary mgmt-btn-primary"
				        onClick={handleSubmit(onFormSubmit)}
				        disabled={!formState.isValid || !selectedDrives.length}>
					{isEditMode ? 'Update' : 'Add'}
				</button>
				<button className="btn btn-default" onClick={() => handleCancel()}>Cancel</button>
			</div>
		</>
	);
};

const CreateEditDriveClassModal = ({
	isOpen,
	isEditMode,
	driveClass = {},
	handleCancel = () => {},
	domains = [],
	// eslint-disable-next-line no-unused-vars
	onSubmit = _ => {}
}) => {

	return (
		<Modal isOpen={isOpen}
		       onClose={() => handleCancel()}
		       title="Drive Class"
		       className="modal-xl">
			<CreateEditDriveClass
				driveClass={driveClass}
				isEditMode={isEditMode}
				handleCancel={handleCancel}
				domains={domains}
				onSubmit={onSubmit}/>
		</Modal>
	);
};

export default CreateEditDriveClassModal;
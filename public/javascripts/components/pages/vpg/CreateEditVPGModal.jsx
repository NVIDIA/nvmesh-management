/*
 * SPDX-FileCopyrightText: Copyright (c) 2026 NVIDIA CORPORATION & AFFILIATES. All rights reserved.
 * SPDX-License-Identifier: Apache-2.0
 */

/* global React, ReactHookForm, consts */

import Input from '../../core/Input.jsx';
import FormControl from '../../core/FormControl.jsx';
import Modal from '../../core/Modal.jsx';
import VolumePRaidOptions from '../volume/VolumePRaidOptions.jsx';
import Select from '../../core/Select.jsx';
import { DiskClassesService } from '../../services/api/diskClasses.service.js';
import { TargetClassesService } from '../../services/api/targetClasses.service.js';
import { TargetsService } from '../../services/api/targets.service.js';
import { VolumeSecurityGroupsService } from '../../services/api/volumeSecurityGroups.service.js';
import Toggle from '../../core/Toggle.jsx';
import VolumeCapacityInput from '../volume/VolumeCapacityInput.jsx';
import CapacityService from '../../services/capacity.service.js';
import { useAppContext } from '../../App.jsx';
import { VolumeProvisioningGroupsService } from '../../services/api/volumeProvisioningGroups.service.js';
import { debounce, copyDefinedProperties } from '../../utils.js';
import VolumeAllocationBar from '../volume/VolumeAllocationBar.jsx';

const { useForm, Controller } = ReactHookForm;
const { useState, useEffect } = React;

const commonVpgProperties = [
	'_id',
	'uuid',
	'name',
	'description',
	'capacity',
	'allowAllocationOnOfflineDrives',
	'domain',
	'isEncrypted',
	'encryption',
	'type',
	'diskClasses',
	'serverClasses',
	'VSGs',
	'allowOverflow'
];

const vpgUpdateOrExtendProperties = ['_id', 'uuid', ...consts.updatableVpgProperties, 'capacity'];

const CreateEditVPG = ({
	vpg = {},
	handleCancel = () => {},
	// eslint-disable-next-line no-unused-vars
	onSubmit = _ => {}
}) => {
	const { unitType } = useAppContext();
	const isCreate = !vpg._id;
	const [pRaidOptions, setPRaidOptions] = useState({});
	const [pRaidOptionsIsValid, setPRaidOptionsIsValid] = useState(true);
	const [disks, setDisks] = useState([]);
	const [diskClasses, setDiskClasses] = useState([]);
	const [VSGs, setVSGs] = useState([]);
	const [targetClasses, setTargetClasses] = useState([]);
	const [domains, setDomains] = useState([]);
	const [totalSpace, setTotalSpace] = useState(0);
	const [allocatedSpace, setAllocatedSpace] = useState(0);
	const [availableMirrors, setAvailableMirrors] = useState(0);
	const { register, handleSubmit, formState, control, watch, setError, clearErrors } = useForm({
		mode: 'all',
		defaultValues: { ...vpg },
		shouldUnregister: true
	});
	const formData = watch();

	const availablePhysicalSpace = totalSpace - allocatedSpace;
	const redundancyRatio = CapacityService.getRedundancyRatio(pRaidOptions) || 0;
	const vpgPhysicalCapacity = CapacityService.getPhysicalSpace(formData.capacity, redundancyRatio);
	const availableUsableSpace = CapacityService.getUsableSpace(availablePhysicalSpace, redundancyRatio);
	const maxAvailableUsableSpace = availableUsableSpace + (vpg.capacity || 0);
	const maxAvailablePhysicalSpace = CapacityService.getPhysicalSpace(maxAvailableUsableSpace, redundancyRatio);
	const isFormValid = formState.isValid && !formState.errors.nameExists && pRaidOptionsIsValid && disks.length > 0;

	const loadAvailableMirrors = async() => {
		const limitBy = { disks: disks.map(disk => disk._id), allowAllocationOnOfflineDrives: formData.allowAllocationOnOfflineDrives };

		const availableMirrorsRes = await TargetsService.getAvailableMirrors(formData.capacity - (vpg.capacity || 0), limitBy);
		setAvailableMirrors(availableMirrorsRes);
	};

	const loadCapacityData = async() => {
		const limitBy = { disks: disks.map(disk => disk._id), allowAllocationOnOfflineDrives: formData.allowAllocationOnOfflineDrives };

		const [totalSpaceRes, allocatedSpaceRes, availableMirrorsRes] = await Promise.all([
			TargetsService.getTotalSpace(limitBy),
			TargetsService.getAllocatedSpace(limitBy),
			TargetsService.getAvailableMirrors(formData.capacity - (vpg.capacity || 0), limitBy),
		]);
		setTotalSpace(totalSpaceRes);
		setAllocatedSpace(allocatedSpaceRes);
		setAvailableMirrors(availableMirrorsRes);
	};

	const loadDisks = async({ serverClasses, diskClasses } = {}) => {
		const disksRes = await DiskClassesService.getDisksByServerAndDiskClasses({
			diskClasses: diskClasses || formData.diskClasses,
			serverClasses: serverClasses || formData.serverClasses
		});
		setDisks(disksRes);
	};

	useEffect(() => {
		const fetch = async() => {
			const [vsgRes, tcRes, dcRes, tcDomains, dcDomains] = await Promise.all([
				VolumeSecurityGroupsService.loadAll(),
				TargetClassesService.loadAll(),
				DiskClassesService.loadAll(),
				TargetClassesService.getDomains('scope'),
				DiskClassesService.getDomains('scope')
			]);
			setVSGs(vsgRes);
			setTargetClasses(tcRes);
			setDiskClasses(dcRes);
			setDomains([...tcDomains, ...dcDomains]);

			loadDisks();
		};

		fetch();
	}, []);

	useEffect(() => {
		loadCapacityData();
	}, [disks, formData.allowAllocationOnOfflineDrives]);

	useEffect(() => {
		const handler = setTimeout(() => {
			loadAvailableMirrors();
		}, 500);

		return () => {
			clearTimeout(handler);
		};
	}, [formData.capacity]);

	const prepareVpgProperties = (data) => {
		const toSubmit = {
			...copyDefinedProperties(vpg, commonVpgProperties),
			...copyDefinedProperties(data, commonVpgProperties),
			...copyDefinedProperties(pRaidOptions, consts.pRaidOptionsPropertiesByRaidLevel[pRaidOptions.RAIDLevel]),
			type: data.isUsedForMD ? consts.volumeTypes.METADATA_VOLUME : consts.volumeTypes.DATA_VOLUME
		};

		return toSubmit;
	};

	const onFormSubmit = (data) => {
		const toSubmit = prepareVpgProperties(data);
		const apiPayload = isCreate ? toSubmit : copyDefinedProperties(toSubmit, vpgUpdateOrExtendProperties);
		onSubmit(apiPayload);
	};

	const isNameExist = async(name) => {
		const filter = { name: { $eq: name } };
		const count = await VolumeProvisioningGroupsService.loadTotal(filter);
		return count > 0;
	};

	const validateNameDebounced = debounce(async(value) => {
		const exists = await isNameExist(value);
		return !exists;
	}, 500);

	const getUsageClass = () => {
		const usageRatio = vpgPhysicalCapacity / availablePhysicalSpace;

		if (usageRatio < 0.5) return 'green';
		if (usageRatio < 0.8) return 'yellow';
		return 'red';
	};

	return (
		<>
			<div className="modal-body">
				<FormControl
					name="name"
					label="Name"
					errorMessage={formState.errors?.name?.message || formState.errors?.nameExists?.message}
				>
					<Input
						name="name"
						className="form-control"
						disabled={!isCreate}
						placeholder="Enter name"
						{...register('name', {
							value: vpg.name,
							required: { value: true, message: 'Name is required' },
							pattern: {
								value: /^[a-zA-Z0-9_\-+=]+$/,
								message: 'Invalid name'
							},
							maxLength: {
								value: 22,
								message: 'Exceed maximum length of 22'
							}
						})}
						onChange={async(e) => {
							const value = e.target.value;

							const isValid = await validateNameDebounced(value);
							if (!isValid) {
								setError('nameExists', { type: 'custom', message: 'Name already exists' });

							} else {
								clearErrors('nameExists');
							}
						}}
						autoFocus
						required
					/>
				</FormControl>

				<FormControl
					name="description"
					label="Description"
					errorMessage={formState.errors?.description?.message}
				>
					<Input
						name="description"
						className="form-control"
						placeholder="Enter description"
						{...register('description', {
							value: vpg.description,
							maxLength: {
								value: 1024,
								message: 'Exceed maximum length of 1024'
							},
						})}
					/>
				</FormControl>

				<VolumePRaidOptions volume={vpg}
				                    availableMirrors={availableMirrors}
				                    onChange={({ data, isValid }) => {
					                    setPRaidOptions(data);
					                    setPRaidOptionsIsValid(isValid);
				                    }}
				                    isUsedForMD={formData.isUsedForMD}
				                    disabled={!isCreate || formData.isUsedForMD}
				                    isVpg/>

				<FormControl
					name="serverClasses"
					label="Target Classes"
					errorMessage={formState.errors?.serverClasses?.message}
				>
					<Controller
						control={control}
						name="serverClasses"
						value={vpg.serverClasses}
						render={({ field: { onChange, value } }) => (
							<Select id="serverClasses"
							        placeholder="Choose Target Classes"
							        value={value}
							        onChange={value => {
								        onChange(value);
								        loadDisks({ serverClasses: value });
							        }}
							        disabled={!isCreate}
							        valueField="_id"
							        labelField="_id"
							        searchField="_id"
							        multiple
							        options={targetClasses}
							/>
						)}
					/>
				</FormControl>

				<FormControl
					name="diskClasses"
					label="Drive Classes"
					errorMessage={formState.errors?.diskClasses?.message}
				>
					<Controller
						control={control}
						name="diskClasses"
						value={vpg.diskClasses}
						render={({ field: { onChange, value } }) => (
							<Select
								id="diskClasses"
								placeholder="Choose Drive Classes"
								value={value}
								onChange={value => {
									onChange(value);
									loadDisks({ diskClasses: value });
								}}
								disabled={!isCreate}
								valueField="_id"
								labelField="_id"
								searchField="_id"
								multiple
								options={diskClasses}
							/>
						)}
					/>
				</FormControl>

				<FormControl
					name="domain"
					label="Protection Domain"
					errorMessage={formState.errors?.domain?.message}
				>
					<Controller
						control={control}
						name="domain"
						value={vpg.domain}
						render={({ field: { onChange, value } }) => (
							<Select
								id="domain"
								placeholder="Choose Protection Domain scope"
								value={value}
								onChange={onChange}
								disabled={!isCreate}
								options={domains.map(domain => ({ text: domain, value: domain }))}
							/>
						)}
					/>
				</FormControl>

				<FormControl
					name="VSGs"
					label="Volume Security Groups"
					errorMessage={formState.errors?.VSGs?.message}
				>
					<Controller
						control={control}
						name="VSGs"
						value={vpg.VSGs}
						render={({ field: { onChange, value } }) => (
							<Select
								id="VSGs"
								placeholder="Choose Volume Security Groups"
								value={value}
								onChange={onChange}
								disabled={!isCreate}
								valueField="_id"
								labelField="_id"
								searchField="_id"
								multiple
								options={VSGs}
							/>
						)}
					/>
				</FormControl>

				<FormControl
					name="capacity"
					label="VPG Reserve Space"
					noAlertIcon
					errorMessage={formState.errors?.capacity?.message}
				>
					<span className={getUsageClass()}>
						{CapacityService.toBiggestUnit(vpgPhysicalCapacity, unitType)}/
						{CapacityService.toBiggestUnit(maxAvailablePhysicalSpace, unitType)}</span>
					<Controller
						key={maxAvailableUsableSpace}
						control={control}
						name="capacity"
						value={vpg.capacity}
						rules={{
							min: {
								value: vpg.capacity,
								message: `Min space is ${CapacityService.toBiggestUnit(vpg.capacity, unitType)}`
							},
							max: {
								value: maxAvailableUsableSpace,
								message: `Max available space is ${CapacityService.toBiggestUnit(maxAvailableUsableSpace, unitType)}`
							}
						}}
						render={({ field: { onChange, value } }) => (
							<VolumeCapacityInput capacity={value}
							                     onChange={onChange}
							                     minCapacity={vpg.capacity || 0}
							                     maxCapacity={maxAvailableUsableSpace}
							/>
						)}
					/>
				</FormControl>

				{totalSpace > 0 && <div className="form-group">
					<VolumeAllocationBar
						pRaidOptions={pRaidOptions}
						volumeAllocatedCapacity={vpg.capacity || 0}
						allocatedSpace={allocatedSpace}
						totalSpace={totalSpace}
						currentCapacity={formData.capacity}
					/>
				</div>}

				<div className="pull-right">
					<i>Total drives: {disks.length}</i>
				</div>

				{(!isCreate || formData.capacity > 0) && <div className="form-group aligned centred">
					<label>Allow allocation outside reserved space</label>
					<Controller
						control={control}
						name="allowOverflow"
						value={vpg.allowOverflow}
						render={({ field: { onChange, value } }) => (
							<Toggle
								isChecked={value}
								disabled={!isCreate}
								onChange={onChange}
							/>
						)}
					/>
				</div>}

				<div className="form-group aligned centred">
					<label>Allocate On Offline Hardware</label>
					<Controller
						control={control}
						name="allowAllocationOnOfflineDrives"
						defaultValue={vpg.allowAllocationOnOfflineDrives}
						render={({ field: { onChange, value } }) => (
							<Toggle
								isChecked={value}
								onChange={onChange}
							/>
						)}
					/>
				</div>

				<div className="form-group aligned centred">
					<label>Encrypted Volume</label>
					<Controller
						control={control}
						name="isEncrypted"
						value={vpg.isEncrypted}
						render={({ field: { onChange, value } }) => (
							<Toggle
								isChecked={value}
								disabled={!isCreate}
								onChange={onChange}
							/>
						)}
					/>
				</div>

				{formData.isEncrypted && <FormControl
					name="encryption.headerSize"
					label="Encryption Header Size"
					errorMessage={formState.errors?.encryption?.headerSize?.message}
				>
					<Input
						name="encryption.headerSize"
						className="form-control"
						disabled={!isCreate}
						{...register('encryption.headerSize', {
							value: vpg.encryption?.headerSize || 16,
							valueAsNumber: true,
							min: {
								value: 1,
								message: 'Min value is 1'
							},
							max: {
								value: 100,
								message: 'Max value is 100'
							}
						})}
						type="number"
						min="1"
						max="100"
						step="1"
						autoFocus
					/>
				</FormControl>}

			</div>
			<div className="modal-footer">
				<button
					className="btn btn-primary mgmt-btn-primary"
					onClick={handleSubmit(onFormSubmit)}
					disabled={!isFormValid}
				>
					{isCreate ? 'Add' : 'Update'}
				</button>
				<button
					className="btn btn-default"
					onClick={() => {
						handleCancel();
					}}
				>
					Cancel
				</button>
			</div>
		</>
	);
};

const CreateEditVPGModal = ({
	isOpen,
	vpg = {},
	handleCancel = () => {},
	// eslint-disable-next-line no-unused-vars
	onSubmit = _ => {}
}) => {

	return (
		<Modal
			isOpen={isOpen}
			disableBackdropClose
			onClose={() => handleCancel()}
			title="Volume Provisioning Group"
			className="modal-lg">
			<CreateEditVPG
				vpg={vpg}
				handleCancel={handleCancel}
				onSubmit={onSubmit}/>
		</Modal>
	);
};

export default CreateEditVPGModal;
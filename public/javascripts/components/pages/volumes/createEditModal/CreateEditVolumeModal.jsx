/*
 * SPDX-FileCopyrightText: Copyright (c) 2026 NVIDIA CORPORATION & AFFILIATES. All rights reserved.
 * SPDX-License-Identifier: Apache-2.0
 */

/* global React, ReactHookForm, consts */

import Input from '../../../core/Input.jsx';
import FormControl from '../../../core/FormControl.jsx';
import Modal from '../../../core/Modal.jsx';
import VolumeCapacityInput from '../../volume/VolumeCapacityInput.jsx';
import { useAppContext } from '../../App.jsx';
import CapacityService from '../../../services/capacity.service.js';
import { VolumeSecurityGroupsService } from '../../../services/api/volumeSecurityGroups.service.js';
import { TargetClassesService } from '../../../services/api/targetClasses.service.js';
import { DiskClassesService } from '../../../services/api/diskClasses.service.js';
import { TargetsService } from '../../../services/api/targets.service.js';
import { VolumeProvisioningGroupsService } from '../../../services/api/volumeProvisioningGroups.service.js';
import Toggle from '../../../core/Toggle.jsx';
import RadioInput from '../../../core/RadioInput.jsx';
import { Tabs, Tab } from '../../../core/Tabs.jsx';
import Select from '../../../core/Select.jsx';
import VolumePRaidOptions from '../../volume/VolumePRaidOptions.jsx';
import VolumeAllocationBar from '../../volume/VolumeAllocationBar.jsx';
import { VolumesService } from '../../../services/api/volumes.service.js';
import { debounce, groupBy, copyDefinedProperties } from '../../../utils.js';
import VolumeClassLimiters from './VolumeClassLimiters.jsx';
import LimitByTargetsAndDrives from './LimitByTargetsAndDrives.jsx';
import { NVMfAccessControl } from './NVMfAccessControl.jsx';
import { RelativeRebuildPriorityControl } from './RelativeRebuildPriorityControl.jsx';
import { AllocationService } from '../../../services/allocation.service.js';
import { SocketService, events } from '../../../services/socket.service.js';

const { useForm, Controller } = ReactHookForm;
const { useState, useEffect, useRef, useMemo } = React;

const commonVolumeProperties = [
	'_id',
	'uuid',
	'name',
	'description',
	'isReadOnly',
	'allowAllocationOnOfflineDrives',
	'sourceID',
	'sourceUUID',
	'relativeRebuildPriority',
];

const commonCustomVolumeProperties = [
	'domain',
	'isEncrypted',
	'encryption',
	'type',
	'diskClasses',
	'serverClasses',
	'limitByDisks',
	'limitByNodes',
	'VSGs'
];

const volumeUpdateOrExtendProperties = ['_id', 'uuid', ...consts.updatableVolumeProperties, 'capacity'];

const CreateEditVolume = ({
	volume = {},
	handleCancel = () => { },
	// eslint-disable-next-line no-unused-vars
	onSubmit = _ => { }
}) => {
	const isCreate = !volume._id;
	const isLoaded = useRef(false);
	const { unitType } = useAppContext();
	const { register, handleSubmit, formState, control, watch, setValue, setError, clearErrors } = useForm({ mode: 'all', defaultValues: volume });
	const [capacityAllocationType, setCapacityAllocationType] = useState(isCreate ?
		consts.capacityAllocationTypes.CUSTOM :
		consts.capacityAllocationTypes.NO_CHANGE);
	const [pRaidOptions, setPRaidOptions] = useState({});
	const [pRaidOptionsIsValid, setPRaidOptionsIsValid] = useState(true);
	const [sourceVolumes, setSourceVolumes] = useState([]);
	const [disks, setDisks] = useState([]);
	const [diskClasses, setDiskClasses] = useState([]);
	const [VSGs, setVSGs] = useState([]);
	const [VPGs, setVPGs] = useState([]);
	const [targetClasses, setTargetClasses] = useState([]);
	const [domains, setDomains] = useState([]);
	const [targets, setTargets] = useState([]);
	const [offlineServersCount, setOfflineServersCount] = useState(0);
	const [totalSpace, setTotalSpace] = useState(0);
	const [allocatedSpace, setAllocatedSpace] = useState(0);
	const [availableMirrors, setAvailableMirrors] = useState(0);
	const isCDV = volume.volumeClass === consts.volumeClass.CDV;
	const formData = watch();

	const VPGsByType = groupBy(VPGs, vpg => vpg.type === consts.volumeTypes.METADATA_VOLUME ? 'metadata' : 'normal');
	const availablePhysicalSpace = totalSpace - allocatedSpace;
	const redundancyRatio = CapacityService.getRedundancyRatio(pRaidOptions) || 0;
	const volumePhysicalCapacity = CapacityService.getPhysicalSpace(formData.capacity, redundancyRatio);
	const availableUsableSpace = CapacityService.getUsableSpace(availablePhysicalSpace, redundancyRatio);
	const maxAvailableSpace = availableUsableSpace + (volume.capacity || 0);
	const maxAvailableSpaceDisplay = CapacityService.toBiggestUnit(maxAvailableSpace, unitType, { digits: 5, roundDown: true });
	const minCapacity = isCreate ? 0 : (volume.capacity || 0);
	const isFormValid = formState.isValid && !formState.errors.noMirrors && !formState.errors.nameExists && (pRaidOptionsIsValid || formData.VPG);

	const calcLimitBy = () => {
		const limitBy = {};

		if (formData.VPG) {
			limitBy.vpg = isCreate ? formData.VPG._id : volume.VPG;
		} else {
			limitBy.disks = disks.map(disk => disk._id);
			limitBy.nodes = formData.limitByNodes || [];

			if (formData.limitByDisks?.length) {
				limitBy.disks = formData.limitByDisks;
			}
		}

		limitBy.allowAllocationOnOfflineDrives = !!formData.allowAllocationOnOfflineDrives;
		return limitBy;
	};

	const loadAvailableMirrors = async() => {
		const limitBy = calcLimitBy();

		const availableMirrorsRes = await TargetsService.getAvailableMirrors(formData.capacity - (volume.capacity || 0), limitBy);
		setAvailableMirrors(availableMirrorsRes);
	};

	useEffect(() => {
		const fetch = async() => {
			const [vsgRes, tcRes, dcRes, tcDomains, dcDomains, targetsRes, offlineServersRes] = await Promise.all([
				VolumeSecurityGroupsService.loadAll(),
				TargetClassesService.loadAll(),
				DiskClassesService.loadAll(),
				TargetClassesService.getDomains('scope'),
				DiskClassesService.getDomains('scope'),
				TargetsService.loadAll(),
				TargetsService.loadTotal({ node_status: { $ne: 1 } })
			]);
			setVSGs(vsgRes);
			setTargetClasses(tcRes);
			setDiskClasses(dcRes);
			setDomains([...tcDomains, ...dcDomains]);
			setTargets(targetsRes);
			setOfflineServersCount(offlineServersRes);

			loadDisks();
			loadVPGs();
		};

		fetch();
		registerToEvents();
	}, []);

	useEffect(() => {
		if (isLoaded.current) {
			loadCapacityData();
		}
	}, [disks, formData.limitByDisks, formData.limitByNodes, formData.VPG, offlineServersCount, formData.allowAllocationOnOfflineDrives]);

	useEffect(() => {
		if (!isLoaded.current) return;

		const handler = setTimeout(() => {
			loadAvailableMirrors();
		}, 500);

		return () => {
			clearTimeout(handler);
		};
	}, [formData.capacity]);

	useEffect(() => {
		if (formData.isUsedAsSnapshot) {
			getSourceVolumes().then(volumes => setSourceVolumes(volumes));
		}
	}, [formData.isUsedAsSnapshot]);

	const loadCapacityData = async() => {
		const limitBy = calcLimitBy();

		const [totalSpaceRes, allocatedSpaceRes, availableMirrorsRes] = await Promise.all([
			TargetsService.getTotalSpace(limitBy),
			TargetsService.getAllocatedSpace(limitBy),
			TargetsService.getAvailableMirrors(formData.capacity - (volume.capacity || 0), limitBy),
		]);
		setTotalSpace(totalSpaceRes);
		setAllocatedSpace(allocatedSpaceRes);
		setAvailableMirrors(availableMirrorsRes);
	};

	useEffect(() => {
		if (formData.VPG) {
			const numberOfMirrors = AllocationService.isMirrored(formData.VPG.RAIDLevel) ? 1 : 0;
			checkMirrorsValidity(formData.VPG, numberOfMirrors);
		}
	}, [availableMirrors]);

	const loadDisks = async({ serverClasses, diskClasses } = {}) => {
		const disksRes = await DiskClassesService.getDisksByServerAndDiskClasses({
			diskClasses: diskClasses || formData.diskClasses,
			serverClasses: serverClasses || formData.serverClasses
		});
		setDisks(disksRes);
		isLoaded.current = true;
	};

	const loadVPGs = async() => {
		const allVPGs = await VolumeProvisioningGroupsService.getAll();
		setVPGs(allVPGs);
	};

	const registerToEvents = () => {
		SocketService.addHandler(events.serversCountChangeEvent.name, ({ payload }) => {
			if (payload.updateType === consts.updateTypes.FULL) {
				setOfflineServersCount(payload.critical);
			}
		});
	};

	const getUsageClass = () => {
		if (capacityAllocationType === consts.capacityAllocationTypes.MAX) {
			return 'red';
		}
		if (capacityAllocationType === consts.capacityAllocationTypes.NO_CHANGE) {
			return '';
		}
		const usageRatio = volumePhysicalCapacity / availablePhysicalSpace;

		if (usageRatio < 0.5) return 'green';
		if (usageRatio < 0.8) return 'yellow';
		return 'red';
	};

	const getSourceVolumes = async() => {
		const filter = {
			isReadOnly: true,
			status: { $nin: [consts.volumeStatuses.PENDING, consts.volumeStatuses.TO_BE_DELETED] },
			action: { $nin: [consts.volumeActions.DELETING, consts.volumeActions.MARKED_FOR_DELETION] }
		};
		const projection = { name: 1, uuid: 1 };
		return await VolumesService.getAll(filter, projection);
	};

	const isNameExist = async(name) => {
		const filter = { name: { $eq: name } };
		const count = await VolumesService.loadTotal(filter);
		return count > 0;
	};

	const validateNameDebounced = debounce(async(value) => {
		const exists = await isNameExist(value);
		return !exists;
	}, 500);

	const onVPGSelected = (vpg) => {
		if (!vpg) {
			clearErrors('noMirrors');
			return;
		}

		const numberOfMirrors = AllocationService.isMirrored(vpg.RAIDLevel) ? 1 : 0;
		checkMirrorsValidity(vpg, numberOfMirrors);

		const vpgRaidOptionsProps = ['RAIDLevel', 'stripeSize', 'stripeWidth', 'dataBlocks', 'parityBlocks',
			'protectionLevel', 'enableCrcCheck', 'ignoreNodeSeparation'];
		const vpgPRaidOptions = {};
		vpgRaidOptionsProps.forEach(prop => {
			if (vpg[prop] !== undefined) {
				vpgPRaidOptions[prop] = vpg[prop];
			}
		});

		setPRaidOptions({ ...vpgPRaidOptions, numberOfMirrors });
	};

	const checkMirrorsValidity = (vpg, numberOfMirrors) => {
		if (!AllocationService.calcHasEnoughMirrors({ ...vpg, numberOfMirrors }, availableMirrors)) {
			setError('noMirrors', { type: 'custom', message: 'No mirrors available' });
		} else {
			clearErrors('noMirrors');
		}
	};

	const onVPGTabSelected = () => {
		setPRaidOptions({});
		clearErrors('noMirrors');
	};

	const prepareCapacityToSubmit = (data) => {
		let capacity;

		if (capacityAllocationType === consts.capacityAllocationTypes.MAX) {
			capacity = consts.volumeCapacity.MAX;
		} else if (capacityAllocationType === consts.capacityAllocationTypes.NO_CHANGE) {
			capacity = consts.volumeCapacity.NO_CHANGE;
		} else {
			capacity = data.capacity;
		}
		return capacity;
	};

	const prepareVolumeProperties = (data) => {
		const toSubmit = {
			capacity: prepareCapacityToSubmit(data),
			...copyDefinedProperties(data, commonVolumeProperties),
		};

		if (data.VPG) {
			toSubmit.VPG = data.VPG._id;
		} else {
			Object.assign(toSubmit, copyDefinedProperties(pRaidOptions, consts.pRaidOptionsPropertiesByRaidLevel[pRaidOptions.RAIDLevel]));
			Object.assign(toSubmit, copyDefinedProperties(data, commonCustomVolumeProperties));

		}

		if (data.mdvSpec) {
			const { VPG, ...mdvSpec } = data.mdvSpec;
			if (VPG)
				toSubmit.mdvSpec = { VPG };
			else
				toSubmit.mdvSpec = mdvSpec;
		}

		if (data.enableNVMf) {
			toSubmit.enableNVMf = data.enableNVMf;
			toSubmit.selectedClientsForNvmf = data.selectedClientsForNvmf;
		}

		if (isCDV) {
			toSubmit.volumeClass = consts.volumeClass.CDV;
			toSubmit.cdvConfig = {
				cdvExtentSizeMib: Number(data.cdvExtentSizeMib) || 1024,
				allocatorSizeGib: data.allocatorSizeGib || 1,
				maxTPVs: data.maxTPVs || 512,
			};
		}

		return toSubmit;
	};

	const onFormSubmit = (data) => {
		const toSubmit = prepareVolumeProperties(data);
		const apiPayload = isCreate ? toSubmit : copyDefinedProperties(toSubmit, volumeUpdateOrExtendProperties);
		onSubmit(apiPayload);
	};

	const dataClassLimiters = (
		<Tabs defaultSelectedTab={formData.limitByNodes?.length ? 1 : 0}>
			<Tab header="Limit By Classes"
			     disabled={formData.limitByNodes?.length}>

				<VolumeClassLimiters
					control={control}
					volume={volume}
					disabled={!isCreate}
					loadDisks={loadDisks}
					targetClasses={targetClasses}
					diskClasses={diskClasses}
					domains={domains}
				/>

			</Tab>
			<Tab header="Limit By Specific Targets and Drives"
			     disabled={formData.serverClasses?.length || formData.diskClasses?.length}>

				<LimitByTargetsAndDrives
					control={control}
					volume={volume}
					formData={formData}
					targets={targets}
				/>

			</Tab>
		</Tabs>
	);


	return (
		<>
			<div className="modal-body">
				<div className="row">
					<div className="col-md-6">
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
									value: volume.name,
									required: 'Name is required',
									validate: value => {
										if (formData.enableNVMf && value.indexOf('_') !== -1) {
											return 'Name cannot contain an underscore if enable access via NVMf is turned on';
										}
										if (value && value.match(/^[a-zA-Z0-9_\-+=]+$/) === null) {
											return 'Name cannot contain special characters';
										}
										if (value && value.endsWith(consts.MetadataVolumeEnding)) {
											return `Name cannot end with ${consts.MetadataVolumeEnding}`;
										}
										return true;
									},
									pattern: {
										value: /^(?!e_|d_).*$/,
										message: 'Name cannot start with e_ or d_'
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
							<textarea
								name="description"
								id="description"
								className="form-control no-resize"
								placeholder="Enter description"
								rows={4}
								{...register('description', {
									value: volume.description,
									maxLength: {
										value: 1024,
										message: 'Exceed maximum length of 1024'
									},
								})}
							/>
						</FormControl>

						{isCDV && (
							<>
								<FormControl
									name="cdvExtentSizeMib"
									label="CDV Extent Size"
									errorMessage={formState.errors?.cdvExtentSizeMib?.message}
								>
									<Controller
										control={control}
										name="cdvExtentSizeMib"
										defaultValue={volume.cdvConfig?.cdvExtentSizeMib || 1024}
										rules={{ required: isCDV ? 'Extent size is required' : false }}
										render={({ field: { onChange, value } }) => (
											<Select
												id="cdv-extent-size"
												disabled={!isCreate}
												value={value}
												onChange={onChange}
												options={consts.cdvExtentSizeMibValues.map(mb => ({
													text: mb >= 1024 ? `${mb / 1024} GB` : `${mb} MB`,
													value: mb
												}))}
											/>
										)}
									/>
								</FormControl>

								<FormControl
									name="allocatorSizeGib"
									label="Allocator Size (GiB)"
									errorMessage={formState.errors?.allocatorSizeGib?.message}
								>
									<Input
										name="allocatorSizeGib"
										type="number"
										className="form-control"
										disabled={!isCreate}
										{...register('allocatorSizeGib', {
											value: volume.cdvConfig?.allocatorSizeGib || 1,
											min: { value: 1, message: 'Minimum is 1 GiB' },
											valueAsNumber: true,
										})}
									/>
								</FormControl>

								<FormControl
									name="maxTPVs"
									label="Max TPVs"
									errorMessage={formState.errors?.maxTPVs?.message}
								>
									<Input
										name="maxTPVs"
										type="number"
										className="form-control"
										{...register('maxTPVs', {
											value: volume.cdvConfig?.maxTPVs || 512,
											min: { value: 1, message: 'Minimum is 1' },
											valueAsNumber: true,
										})}
									/>
								</FormControl>
							</>
						)}

					</div>
					<div className="col-md-6">
						<FormControl
							name="capacity"
							label="Volume Capacity"
							noAlertIcon
							topHint={(
								<i className={getUsageClass()}>
									{!isCreate && `Current: ${CapacityService.toBiggestUnit(volume.capacity, unitType)}, `}
									Maximum Available: {maxAvailableSpaceDisplay}
								</i>
							)}
							errorMessage={formState.errors?.capacity?.message}
						>
							<div className="form-group">
								<RadioInput
									name="capacityAllocationType"
									value={consts.capacityAllocationTypes.CUSTOM}
									checked={capacityAllocationType === consts.capacityAllocationTypes.CUSTOM}
									onChange={e => setCapacityAllocationType(e.target.value)}
								>
									<Controller
										// force re-render when capacityAllocationType or availableUsableSpace changes
										key={`${maxAvailableSpace}-${capacityAllocationType}`}
										control={control}
										name="capacity"
										defaultValue={volume.capacity}
										disabled={capacityAllocationType !== consts.capacityAllocationTypes.CUSTOM}
										rules={
											capacityAllocationType === consts.capacityAllocationTypes.CUSTOM ?
												{
													validate: val => {
														if (val === 0) return 'Capacity is required';
														return true;
													},
													min: {
														value: minCapacity,
														message: `Min space is ${CapacityService.toBiggestUnit(minCapacity, unitType)}`
													},
													max: {
														value: maxAvailableSpace,
														message: `Max available space is ${maxAvailableSpaceDisplay}`
													},
												} : {}
										}
										render={({ field: { onChange, value, onBlur } }) => (
											<div className="flex-1">
												<VolumeCapacityInput
													disabled={capacityAllocationType !== consts.capacityAllocationTypes.CUSTOM}
													capacity={value}
													onChange={onChange}
													minCapacity={minCapacity}
													maxCapacity={maxAvailableSpace}
													onBlur={onBlur}
												/>
											</div>
										)}
									/>
								</RadioInput>
							</div>
							<div className="form-group">
								<RadioInput
									name="capacityAllocationType"
									value={consts.capacityAllocationTypes.MAX}
									checked={capacityAllocationType === consts.capacityAllocationTypes.MAX}
									onChange={e => {
										setCapacityAllocationType(e.target.value);
										setValue('capacity', volume.capacity);
									}}
								>
									<label style={{ fontWeight: `${capacityAllocationType === consts.capacityAllocationTypes.MAX ? 'bold' : 'normal'}` }}>
										Maximum, as much as possible
									</label>
								</RadioInput>
							</div>
							{!isCreate && <div className="form-group">
								<RadioInput
									name="capacityAllocationType"
									value={consts.capacityAllocationTypes.NO_CHANGE}
									checked={capacityAllocationType === consts.capacityAllocationTypes.NO_CHANGE}
									onChange={e => {
										setCapacityAllocationType(e.target.value);
										setValue('capacity', volume.capacity);
									}}
								>
									<label style={{ fontWeight: `${capacityAllocationType === consts.capacityAllocationTypes.NO_CHANGE ? 'bold' : 'normal'}` }}>
										Current, no size change
									</label>
								</RadioInput>
							</div>}
						</FormControl>

						{offlineServersCount > 0 && !formData.allowAllocationOnOfflineDrives && <p className="red">
							<i className="ion ion-alert mr-5"></i>
							<small> Total space may be reduced due to non-functional targets.</small>
						</p>}

						<FormControl
							label="Volume Settings"
						>
							<div className="form-group aligned centred inline-form-group">
								<label>Read Only</label>
								<Controller
									control={control}
									name="isReadOnly"
									defaultValue={volume.isReadOnly}
									render={({ field: { onChange, value } }) => (
										<Toggle
											isChecked={value}
											onChange={onChange}
											disabled={formData.isUsedAsSnapshot}
										/>
									)}
								/>
							</div>
							<div className="form-group aligned centred inline-form-group">
								<label>Use as a Snapshot</label>
								<Controller
									control={control}
									name="isUsedAsSnapshot"
									defaultValue={volume.isUsedAsSnapshot}
									render={({ field: { onChange, value } }) => (
										<Toggle
											isChecked={value}
											onChange={value => {
												onChange(value);
												if (value) {
													setValue('isReadOnly', false);
												}
											}}
											disabled={!isCreate}
										/>
									)}
								/>
							</div>
							<div className="form-group aligned centred inline-form-group">
								<label>Allocate On Offline Hardware</label>
								<Controller
									control={control}
									name="allowAllocationOnOfflineDrives"
									defaultValue={volume.allowAllocationOnOfflineDrives}
									render={({ field: { onChange, value } }) => (
										<Toggle
											isChecked={value}
											onChange={onChange}
										/>
									)}
								/>
							</div>

							{formData.isUsedAsSnapshot && <FormControl
								name="sourceVolume"
								label="Snapshot Source Volume"
								errorMessage={formState.errors?.sourceVolume?.message}
							>
								<Controller
									control={control}
									name="sourceVolume"
									defaultValue={volume.sourceUUID}
									rules={{
										required: 'Snapshot Source Volume is required',
									}}
									render={({ field: { onChange, value, onBlur } }) => (
										<Select
											id="sourceVolume"
											options={sourceVolumes}
											onChange={onChange}
											value={value}
											placeholder="Choose Source Volume"
											valueField="uuid"
											labelField="name"
											searchField="name"
											onBlur={onBlur}
										/>
									)}
								/>
							</FormControl>}

						</FormControl>

					</div>
				</div>

				<Tabs defaultSelectedTab={isCreate || volume.VPG ? 0 : 1}>
					<Tab header="Volume Provisioning Group"
					     onSelect={onVPGTabSelected}
					     disabled={!isCreate}>
						<FormControl
							name="VPG"
							label="Volume Provisioning Group"
							className="form-group-md"
							errorMessage={formState.errors?.VPG?.message || formState.errors?.noMirrors?.message}
						>
							<Controller
								control={control}
								name="VPG"
								defaultValue={volume.VPG}
								rules={{
									required: 'Volume Provisioning Group is required',
								}}
								shouldUnregister={isCreate}
								render={({ field: { onChange, value, onBlur } }) => (
									<Select
										id="VPG"
										options={useMemo(() => VPGsByType.normal, [VPGsByType.normal])}
										onChange={vpg => {
											onChange(vpg);
											onVPGSelected(vpg);
										}}
										disabled={!isCreate}
										value={isCreate ? value : { _id: value, name: value }}
										valueAsObject
										placeholder="Choose Volume Provisioning Group"
										valueField="_id"
										labelField="name"
										searchField="name"
										clearButton
										onBlur={onBlur}
									/>
								)}
							/>
						</FormControl>

						{formData.isUsedAsSnapshot && <FormControl
							name="mdvSpec.VPG"
							label="Metadata Volume Provisioning Group"
							className="form-group-md"
							errorMessage={formState.errors?.mdvSpec?.VPG?.message}
						>
							<Controller
								control={control}
								name="mdvSpec.VPG"
								defaultValue={volume.mdvSpec?.VPG}
								rules={{
									required: 'Metadata Volume Provisioning Group is required',
								}}
								render={({ field: { onChange, value, onBlur } }) => (
									<Select
										id="mdVpg"
										options={VPGsByType.metadata}
										onChange={onChange}
										value={value}
										placeholder="Choose Metadata Volume Provisioning Group"
										valueField="_id"
										labelField="name"
										searchField="name"
										onBlur={onBlur}
										clearButton
									/>
								)}
							/>
						</FormControl>}

						<Tabs>
							<Tab header="Export">

								<NVMfAccessControl
									formData={formData}
									control={control}
									volume={volume}
									disabled={!isCreate}
								/>

							</Tab>
							<Tab header="Advanced">
								<RelativeRebuildPriorityControl
									defaultValue={volume.relativeRebuildPriority || 0}
									RAIDLevel={volume.RAIDLevel}
									register={register}
									errorMessage={formState.errors?.relativeRebuildPriority?.message}
								/>

							</Tab>
						</Tabs>
					</Tab>
					<Tab header="Custom"
					     disabled={formData.VPG}>
						<Tabs>
							<Tab header="Layout">
								<VolumePRaidOptions volume={volume}
								                    className="raid-options-container-inline"
								                    availableMirrors={availableMirrors}
								                    onChange={({ data, isValid }) => {
									                    setPRaidOptions(data);
									                    setPRaidOptionsIsValid(isValid);
								                    }}
								                    disabled={!isCreate}/>

								{formData.isUsedAsSnapshot && (
									<Tabs>
										<Tab header="Data Volume Limiters">
											{dataClassLimiters}
										</Tab>

										<Tab header="Metadata Volume Limiters">

											<Tabs defaultSelectedTab={formData.mdvSpec?.limitByNodes?.length ? 1 : 0}>
												<Tab header="Limit By Classes"
												     disabled={formData.mdvSpec?.limitByNodes?.length}>

													<VolumeClassLimiters
														control={control}
														volume={volume.mdvSpec}
														disabled={!isCreate}
														targetClasses={targetClasses}
														diskClasses={diskClasses}
														domains={domains}
														formPath="mdvSpec"
													/>

												</Tab>
												<Tab header="Limit By Specific Targets and Drives"
												     disabled={formData.mdvSpec?.serverClasses?.length || formData.mdvSpec?.diskClasses?.length}>

													<LimitByTargetsAndDrives
														control={control}
														volume={volume.mdvSpec}
														disabled={!isCreate}
														formData={formData}
														targets={targets}
														formPath="mdvSpec"
													/>

												</Tab>
											</Tabs>

										</Tab>
									</Tabs>
								)}

								{!formData.isUsedAsSnapshot && dataClassLimiters}

							</Tab>
							<Tab header="Security">
								<FormControl
									name="VSGs"
									label="Volume Security Groups"
									className="form-group-md"
									errorMessage={formState.errors?.VSGs?.message}
								>
									<Controller
										control={control}
										name="VSGs"
										value={volume.VSGs}
										render={({ field: { onChange, value } }) => (
											<Select
												id="VSGs"
												placeholder="Choose Volume Security Groups"
												value={value}
												onChange={onChange}
												valueField="_id"
												labelField="_id"
												searchField="_id"
												multiple
												options={VSGs}
											/>
										)}
									/>
								</FormControl>

								<div className="form-group aligned centred">
									<label>Encrypted Volume</label>
									<Controller
										control={control}
										name="isEncrypted"
										value={volume.isEncrypted}
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
									className="form-group-md"
									errorMessage={formState.errors?.encryption?.headerSize?.message}
								>
									<Input
										name="encryption.headerSize"
										className="form-control"
										disabled={!isCreate}
										{...register('encryption.headerSize', {
											value: volume.encryption?.headerSize || 16,
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
							</Tab>
							<Tab header="Export">
								<NVMfAccessControl
									formData={formData}
									control={control}
									volume={volume}
								/>
							</Tab>
							<Tab header="Advanced">
								<RelativeRebuildPriorityControl
									defaultValue={volume.relativeRebuildPriority || 0}
									RAIDLevel={volume.RAIDLevel}
									register={register}
									errorMessage={formState.errors?.relativeRebuildPriority?.message}
								/>
							</Tab>
						</Tabs>
					</Tab>
				</Tabs>

				{totalSpace > 0 && <div className="form-group">
					<VolumeAllocationBar
						pRaidOptions={pRaidOptions}
						volumeAllocatedCapacity={volume.capacity || 0}
						allocatedSpace={allocatedSpace}
						totalSpace={totalSpace}
						currentCapacity={formData.capacity}
					/>
				</div>}
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

const CreateEditVolumeModal = ({
	isOpen,
	volume = {},
	handleCancel = () => { },
	// eslint-disable-next-line no-unused-vars
	onSubmit = _ => { }
}) => {
	const isCreate = !volume._id;
	const isCDV = volume.volumeClass === consts.volumeClass.CDV;
	const entityName = isCDV ? 'CDV' : 'Volume';

	return (
		<Modal
			isOpen={isOpen}
			disableBackdropClose
			onClose={() => handleCancel()}
			className="large-modal"
			title={isCreate ? `Create ${entityName}` : `Edit ${entityName}`}>

			<CreateEditVolume
				handleCancel={handleCancel}
				onSubmit={onSubmit}
				volume={volume}/>
		</Modal>
	);
};

export default CreateEditVolumeModal;
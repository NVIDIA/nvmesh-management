/*
 * SPDX-FileCopyrightText: Copyright (c) 2026 NVIDIA CORPORATION & AFFILIATES. All rights reserved.
 * SPDX-License-Identifier: Apache-2.0
 */

/* global React, consts, ReactHookForm */

import Modal from '../../core/Modal.jsx';
import FormControl from '../../core/FormControl.jsx';
import Input from '../../core/Input.jsx';
import Select from '../../core/Select.jsx';
import { VolumesService } from '../../services/api/volumes.service.js';
import CapacityService from '../../services/capacity.service.js';
import { useAppContext } from '../../App.jsx';

const { useForm, Controller } = ReactHookForm;
const { useState, useEffect } = React;

const CreateTPVModal = ({
	isOpen,
	tpv = {},
	handleCancel = () => {},
	// eslint-disable-next-line no-unused-vars
	onSubmit = _ => {}
}) => {
	const isCreate = !tpv._id;
	const { unitType } = useAppContext();
	const unitLabel = unitType === consts.unitType.BINARY ? 'GiB' : 'GB';
	const { register, handleSubmit, formState, control, watch } = useForm({ mode: 'all' });
	const [cdvs, setCDVs] = useState([]);
	const selectedCdvId = watch('cdvId', tpv.tpvConfig?.cdvId || null);
	const selectedCdv = cdvs.find(c => c._id === selectedCdvId);
	const isEncryptedWatch = watch('isEncrypted', tpv.isEncrypted || false);

	useEffect(() => {
		VolumesService.getCDVs().then(result => {
			if (Array.isArray(result)) setCDVs(result);
		});
	}, []);

	const onFormSubmit = (data) => {
		const payload = {
			name: data.name,
			description: data.description || '',
			volumeClass: consts.volumeClass.TPV,
			capacity: Number(data.capacity),
			tpvConfig: {
				cdvId: data.cdvId,
				tpvExtentSizeKB: Number(data.tpvExtentSizeKB),
			},
		};

		if (data.isEncrypted) {
			payload.isEncrypted = true;
			payload.encryption = { headerSize: Number(data.encryptionHeaderSize) || 16 };
		}

		if (!isCreate) {
			payload._id = tpv._id;
			payload.uuid = tpv.uuid;
		}

		onSubmit(payload);
	};

	const cdvOptions = cdvs.map(cdv => {
		const tpvUsage = cdv.cdvConfig?.maxTPVs ? `${cdv.tpvCount || 0}/${cdv.cdvConfig.maxTPVs} TPVs, ` : '';
		return { text: `${cdv.name} (${tpvUsage}${CapacityService.toBiggestUnit(cdv.capacity, unitType)})`, value: cdv._id };
	});

	const maxExtentKB = selectedCdv ? selectedCdv.cdvConfig?.cdvExtentSizeMib * 1024 : Infinity;
	const extentSizeOptions = consts.tpvExtentSizeKBValues
		.filter(kb => kb <= maxExtentKB)
		.map(kb => ({
			text: kb >= 1024 ? `${kb / 1024} MB` : `${kb} KB`,
			value: kb,
		}));

	return (
		<Modal
			isOpen={isOpen}
			disableBackdropClose
			onClose={() => handleCancel()}
			title={isCreate ? 'Create Thin-Provisioned Volume' : 'Edit Thin-Provisioned Volume'}
		>
			<div className="modal-body">
				<div className="row">
					<div className="col-md-6">

						<FormControl
							name="name"
							label="Name"
							errorMessage={formState.errors?.name?.message}
						>
							<Input
								name="name"
								className="form-control"
								disabled={!isCreate}
								placeholder="Enter name"
								autoFocus
								required
								{...register('name', {
									value: tpv.name,
									required: 'Name is required',
									validate: value => {
										if (value && value.match(/^[a-zA-Z0-9_\-+=]+$/) === null)
											return 'Name cannot contain special characters';
										return true;
									},
									maxLength: {
										value: 22,
										message: 'Exceed maximum length of 22'
									},
								})}
							/>
						</FormControl>

						<FormControl
							name="description"
							label="Description"
							errorMessage={formState.errors?.description?.message}
						>
							<textarea
								name="description"
								className="form-control no-resize"
								placeholder="Enter description"
								rows={3}
								{...register('description', {
									value: tpv.description,
									maxLength: {
										value: 1024,
										message: 'Exceed maximum length of 1024'
									},
								})}
							/>
						</FormControl>

					</div>
					<div className="col-md-6">

						<FormControl
							name="cdvId"
							label="Carrier Direct Volume (CDV)"
							errorMessage={formState.errors?.cdvId?.message}
						>
							<Controller
								control={control}
								name="cdvId"
								defaultValue={tpv.tpvConfig?.cdvId || null}
								rules={{ required: isCreate ? 'CDV is required' : false }}
								render={({ field: { onChange, value } }) => (
									<Select
										id="cdv-select"
										disabled={!isCreate}
										value={value}
										onChange={onChange}
										options={cdvOptions}
										placeholder="Select a CDV..."
									/>
								)}
							/>
						</FormControl>

						<FormControl
							name="tpvExtentSizeKB"
							label="Extent Size"
							errorMessage={formState.errors?.tpvExtentSizeKB?.message}
						>
							<Controller
								control={control}
								name="tpvExtentSizeKB"
								defaultValue={tpv.tpvConfig?.tpvExtentSizeKB || 1024}
								rules={{ required: 'Extent size is required' }}
								render={({ field: { onChange, value } }) => (
									<Select
										id="tpv-extent-size"
										disabled={!isCreate}
										value={value}
										onChange={onChange}
										options={extentSizeOptions}
									/>
								)}
							/>
						</FormControl>

						<FormControl
							name="capacity"
							label={`TPV Capacity (Virtual Size) (${unitLabel})`}
							errorMessage={formState.errors?.capacity?.message}
							topHint={selectedCdv
								? <i className="text-muted">CDV capacity: {CapacityService.toBiggestUnit(selectedCdv.capacity, unitType)}</i>
								: undefined}
						>
							<Input
								name="capacity"
								type="number"
								className="form-control"
								placeholder="e.g. 100"
								{...register('capacity', {
									value: tpv.capacity,
									required: 'Capacity is required',
									min: { value: 1, message: `Minimum size is 1 ${unitLabel}` },
									valueAsNumber: true,
								})}
							/>
						</FormControl>

						<FormControl name="isEncrypted" label="Encryption">
							<label className="checkbox-inline">
								<input
									type="checkbox"
									disabled={!isCreate}
									defaultChecked={tpv.isEncrypted || false}
									{...register('isEncrypted')}
								/>
								{' '}Encrypt this TPV (LUKS)
							</label>
						</FormControl>

						{isEncryptedWatch && (
							<FormControl
								name="encryptionHeaderSize"
								label="LUKS Header Size (MB)"
								errorMessage={formState.errors?.encryptionHeaderSize?.message}
							>
								<Input
									name="encryptionHeaderSize"
									type="number"
									className="form-control"
									placeholder="16"
									disabled={!isCreate}
									{...register('encryptionHeaderSize', {
										value: tpv.encryption?.headerSize || 16,
										min: { value: 1, message: 'Minimum header size is 1 MB' },
										max: { value: 100, message: 'Maximum header size is 100 MB' },
										valueAsNumber: true,
									})}
								/>
							</FormControl>
						)}

					</div>
				</div>
			</div>

			<div className="modal-footer">
				<button
					className="btn btn-primary mgmt-btn-primary"
					onClick={handleSubmit(onFormSubmit)}
					disabled={!formState.isValid}
				>
					{isCreate ? 'Create' : 'Update'}
				</button>
				<button
					className="btn btn-default"
					onClick={() => handleCancel()}
				>
					Cancel
				</button>
			</div>
		</Modal>
	);
};

export default CreateTPVModal;

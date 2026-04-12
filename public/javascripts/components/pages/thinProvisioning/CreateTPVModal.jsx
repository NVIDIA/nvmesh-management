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
	const { register, handleSubmit, formState, control, watch } = useForm({ mode: 'all' });
	const [cdvs, setCDVs] = useState([]);
	const selectedCdvId = watch('cdvId', tpv.tpvConfig?.cdvId || null);
	const selectedCdv = cdvs.find(c => c._id === selectedCdvId);

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
			tpvConfig: {
				cdvId: data.cdvId,
				tpvExtentSizeKB: data.tpvExtentSizeKB,
				virtualSizeGB: Number(data.virtualSizeGB),
				maxVirtualSizeGB: Number(data.maxVirtualSizeGB || data.virtualSizeGB),
			},
		};

		if (!isCreate) {
			payload._id = tpv._id;
			payload.uuid = tpv.uuid;
		}

		onSubmit(payload);
	};

	const cdvOptions = cdvs.map(cdv => ({
		text: `${cdv.name} (${cdv.cdvConfig?.maxTPVs ? (cdv.tpvCount || 0) + '/' + cdv.cdvConfig.maxTPVs + ' TPVs, ' : ''}${cdv.capacity} GB)`,
		value: cdv._id,
	}));

	const maxExtentKB = selectedCdv ? selectedCdv.cdvConfig?.cdvExtentSizeMB * 1024 : Infinity;
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
							name="virtualSizeGB"
							label="Virtual Size (GB)"
							errorMessage={formState.errors?.virtualSizeGB?.message}
							topHint={selectedCdv
								? <i className="text-muted">CDV capacity: {selectedCdv.capacity} GB</i>
								: undefined}
						>
							<Input
								name="virtualSizeGB"
								type="number"
								className="form-control"
								placeholder="e.g. 100"
								{...register('virtualSizeGB', {
									value: tpv.tpvConfig?.virtualSizeGB,
									required: 'Virtual size is required',
									min: { value: 1, message: 'Minimum size is 1 GB' },
									valueAsNumber: true,
								})}
							/>
						</FormControl>

						<FormControl
							name="maxVirtualSizeGB"
							label="Max Virtual Size (GB)"
							errorMessage={formState.errors?.maxVirtualSizeGB?.message}
						>
							<Input
								name="maxVirtualSizeGB"
								type="number"
								className="form-control"
								placeholder="e.g. 1000"
								{...register('maxVirtualSizeGB', {
									value: tpv.tpvConfig?.maxVirtualSizeGB,
									min: { value: 1, message: 'Minimum size is 1 GB' },
									valueAsNumber: true,
								})}
							/>
						</FormControl>

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

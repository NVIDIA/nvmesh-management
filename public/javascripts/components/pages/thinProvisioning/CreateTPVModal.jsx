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
import { useAppContext } from '../App.jsx';

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
	const splitMode = watch('splitMode', !!tpv.tpvConfig?.metaCdvId);
	const selectedMetaCdvId = watch('metaCdvId', tpv.tpvConfig?.metaCdvId || null);
	const selectedMetaCdv = cdvs.find(c => c._id === selectedMetaCdvId);
	const capacityWatch = Number(watch('capacity', tpv.capacity || 0)) || 0;
	const tpvExtentSizeKBWatch = Number(watch('tpvExtentSizeKB', tpv.tpvConfig?.tpvExtentSizeKB || 1024)) || 1024;
	const metaTpvExtentSizeKBWatch = Number(watch('metaTpvExtentSizeKB', tpv.tpvConfig?.metaTpvExtentSizeKB || 1024)) || 1024;
	const isEncryptedWatch = watch('isEncrypted', tpv.isEncrypted || false);

	// Mirror of server-side computeMetaVirtualSizeGB (modules/volume.js §3.3 of
	// TPV_MetadataCDV.md). Purely informational — the server recomputes on save.
	const computeMetaVirtualSizeGB = (virtualSizeGB, dataKB, metaKB) => {
		if (!virtualSizeGB || !dataKB || !metaKB) return 0;
		const TPV_L1_HEADER_BYTES = 64;
		const TPV_TREE_ENTRY_BYTES = 8;
		const GiB = Math.pow(2, 30);
		const numVirtExtents = Math.ceil((virtualSizeGB * 1024 * 1024) / dataKB);
		const rawL2 = numVirtExtents * TPV_TREE_ENTRY_BYTES;
		const numL2Tables = Math.ceil(rawL2 / (metaKB * 1024));
		const rawL1 = numL2Tables * TPV_TREE_ENTRY_BYTES + TPV_L1_HEADER_BYTES;
		const raw = rawL1 + rawL2;
		const withSafety = Math.ceil((raw * 11) / 10);
		return Math.max(1, Math.ceil(withSafety / GiB));
	};
	const autoMetaSizeGB = splitMode
		? computeMetaVirtualSizeGB(capacityWatch, tpvExtentSizeKBWatch, metaTpvExtentSizeKBWatch)
		: 0;

	useEffect(() => {
		VolumesService.getCDVs().then(result => {
			if (Array.isArray(result)) setCDVs(result);
		});
	}, []);

	const onFormSubmit = (data) => {
		const tpvConfig = {
			cdvId: data.cdvId,
			tpvExtentSizeKB: Number(data.tpvExtentSizeKB),
		};
		// Split-mode payload — metaVirtualSizeGB is intentionally omitted;
		// management auto-computes it (see TPV_MetadataCDV.md §3.3).
		if (data.splitMode && data.metaCdvId) {
			tpvConfig.metaCdvId = data.metaCdvId;
			tpvConfig.metaTpvExtentSizeKB = Number(data.metaTpvExtentSizeKB);
		}

		const payload = {
			name: data.name,
			description: data.description || '',
			volumeClass: consts.volumeClass.TPV,
			capacity: Number(data.capacity),
			tpvConfig,
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
	// Metadata-CDV picker excludes the selected data CDV — the two must differ
	// in split mode (enforced server-side; surface it client-side too).
	const metaCdvOptions = cdvOptions.filter(opt => opt.value !== selectedCdvId);

	const maxExtentKB = selectedCdv ? selectedCdv.cdvConfig?.cdvExtentSizeMib * 1024 : Infinity;
	const extentSizeOptions = consts.tpvExtentSizeKBValues
		.filter(kb => kb <= maxExtentKB)
		.map(kb => ({
			text: kb >= 1024 ? `${kb / 1024} MB` : `${kb} KB`,
			value: kb,
		}));
	const maxMetaExtentKB = selectedMetaCdv ? selectedMetaCdv.cdvConfig?.cdvExtentSizeMib * 1024 : Infinity;
	const metaExtentSizeOptions = consts.tpvExtentSizeKBValues
		.filter(kb => kb <= maxMetaExtentKB)
		.map(kb => ({
			text: kb >= 1024 ? `${kb / 1024} MB` : `${kb} KB`,
			value: kb,
		}));
	// Surfaced as a subtle warning when the chosen metadata CDV cannot fit the
	// server-side auto-computed metaVirtualSizeGB. Server will reject the
	// save, but giving the user advance warning avoids a round-trip.
	const metaOverCapacity = splitMode && selectedMetaCdv && autoMetaSizeGB > (selectedMetaCdv.capacity || 0);

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

						<FormControl name="splitMode" label="Metadata Placement">
							<label className="checkbox-inline">
								<input
									type="checkbox"
									disabled={!isCreate}
									defaultChecked={!!tpv.tpvConfig?.metaCdvId}
									{...register('splitMode')}
								/>
								{' '}Split data and metadata across two CDVs
							</label>
							<div><small className="text-muted">
								Recommended: pair an EC CDV (data) with a mirror-backed
								CDV (metadata) for better small-write performance.
							</small></div>
						</FormControl>

						{splitMode && (
							<FormControl
								name="metaCdvId"
								label="Metadata CDV"
								errorMessage={formState.errors?.metaCdvId?.message}
							>
								<Controller
									control={control}
									name="metaCdvId"
									defaultValue={tpv.tpvConfig?.metaCdvId || null}
									rules={{ required: splitMode && isCreate ? 'Metadata CDV is required in split mode' : false }}
									render={({ field: { onChange, value } }) => (
										<Select
											id="meta-cdv-select"
											disabled={!isCreate}
											value={value}
											onChange={onChange}
											options={metaCdvOptions}
											placeholder="Select a metadata CDV..."
										/>
									)}
								/>
							</FormControl>
						)}

						{splitMode && (
							<FormControl
								name="metaTpvExtentSizeKB"
								label="Metadata Extent Size"
								errorMessage={formState.errors?.metaTpvExtentSizeKB?.message}
								topHint={autoMetaSizeGB > 0
									? <i className={metaOverCapacity ? 'text-danger' : 'text-muted'}>
										{/* Always rendered in GiB — the 1 GiB volume-allocation
										    quantum is what management reserves on the metadata
										    CDV, regardless of the user's display unit preference. */}
										Metadata capacity (auto-sized): {autoMetaSizeGB} GiB
										{metaOverCapacity && selectedMetaCdv &&
											` — exceeds metadata CDV capacity (${
												CapacityService.toBiggestUnit(selectedMetaCdv.capacity, unitType)
											})`}
									</i>
									: undefined}
							>
								<Controller
									control={control}
									name="metaTpvExtentSizeKB"
									defaultValue={tpv.tpvConfig?.metaTpvExtentSizeKB || 1024}
									rules={{ required: splitMode ? 'Metadata extent size is required' : false }}
									render={({ field: { onChange, value } }) => (
										<Select
											id="meta-tpv-extent-size"
											disabled={!isCreate}
											value={value}
											onChange={onChange}
											options={metaExtentSizeOptions}
										/>
									)}
								/>
							</FormControl>
						)}

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

/*
 * SPDX-FileCopyrightText: Copyright (c) 2026 NVIDIA CORPORATION & AFFILIATES. All rights reserved.
 * SPDX-License-Identifier: Apache-2.0
 */

/* global React, ReactHookForm, consts */

import Input from '../../core/Input.jsx';
import FormControl from '../../core/FormControl.jsx';
import Toggle from '../../core/Toggle.jsx';
import Select from '../../core/Select.jsx';
import { AllocationService } from '../../services/allocation.service.js';

const { useEffect } = React;
const { useForm, Controller } = ReactHookForm;

const hiddenVolumeTypes = { [consts.RAIDLevel.JBOD]: true };

const VolumePRaidOptions = ({
	volume,
	availableMirrors,
	disabled,
	isUsedForMD,
	isVpg,
	// eslint-disable-next-line no-unused-vars
	onChange = _ => {},
	style,
	className = ''
}) => {
	const { register, formState, control, watch, setError, clearErrors, setValue, trigger } = useForm({
		mode: 'all',
		defaultValues: {
			RAIDLevel: consts.RAIDLevel.CONCATENATED,
			stripeWidth: 2,
			dataBlocks: 8,
			parityBlocks: 2,
			protectionLevel: consts.separationTypes.FULL,
			enableCrcCheck: false,
			...volume,
			// case where we edit a volume created with ignoreNodeSeparation = true (backwards compatibility)
			...(!volume?.protectionLevel && volume?.ignoreNodeSeparation && { protectionLevel: consts.separationTypes.IGNORE }),
		},
		shouldUnregister: true
	});
	const formData = watch();

	const isMirrored = AllocationService.isMirrored(formData.RAIDLevel);
	const isEC = AllocationService.isEC(formData.RAIDLevel);
	const isStriped = AllocationService.isStriped(formData.RAIDLevel);

	const isCRC = [
		consts.RAIDLevel.MIRRORED_RAID_1,
		consts.RAIDLevel.STRIPED_AND_MIRRORED_RAID_10,
		consts.RAIDLevel.ERASURE_CODING,
		consts.RAIDLevel.STRIPED_ERASURE_CODING
	].includes(formData.RAIDLevel);

	const emitOnChange = () => {
		const data = { ...formData };

		if (isStriped || isEC) {
			data.stripeSize = consts.DEFAULT_STRIPE_SIZE_BLOCKS;
		}

		// trigger the validation. for some reason, the formState.isValid is not updated otherwise
		trigger();

		onChange({
			data,
			isValid: formState.isValid && !formState.errors.noMirrors
		});
	};

	useEffect(() => {
		if (isUsedForMD) {
			setValue('RAIDLevel', consts.defaultMetadataRAIDLevel);
		}
	}, [isUsedForMD]);

	useEffect(() => {
		setValue('enableCrcCheck', volume.enableCrcCheck ?? isEC);
	}, [formData.RAIDLevel]);

	useEffect(() => {
		if (isMirrored || isEC) {
			const redundancy = isEC ? formData.parityBlocks : formData.numberOfMirrors;
			if (!redundancy)
				return;

			if (!formData.protectionLevel || (formData.protectionLevel === consts.separationTypes.FULL && redundancy <= 1))
				setValue('protectionLevel', redundancy > 1 ? consts.separationTypes.FULL : consts.separationTypes.MINIMAL);
		}
	}, [formData.RAIDLevel, formData.numberOfMirrors, formData.parityBlocks]);

	useEffect(() => {
		if (!AllocationService.calcHasEnoughMirrors(formData, availableMirrors)) {
			setError('noMirrors', { type: 'custom', message: 'No mirrors available' });
		} else {
			clearErrors('noMirrors');
		}
		emitOnChange();

	}, [formData.RAIDLevel, formData.protectionLevel, formData.allowAllocationOnOfflineDrives,
		formData.dataBlocks, formData.parityBlocks, formData.stripeWidth, formData.enableCrcCheck, formData.numberOfMirrors,
		availableMirrors, formState.isValid]);

	return (
		<div style={style} className={`raid-options-container ${className}`}>
			<FormControl name="RAIDLevel"
			             label="Volume Type"
			             errorMessage={formState.errors?.RAIDLevel?.message || formState.errors?.noMirrors?.message}>
				<Controller
					control={control}
					name="RAIDLevel"
					value={volume.RAIDLevel}
					rules={{
						required: 'Volume Type is required'
					}}
					render={({ field: { onChange, value } }) => (
						<Select id="RAIDLevel"
						        value={value}
						        onChange={onChange}
						        disabled={disabled}
						        options={Object.values(consts.RAIDLevel)
							        .filter(raidLevel => !hiddenVolumeTypes[raidLevel])
							        .map(raidLevel => ({ text: raidLevel, value: raidLevel }))}
						/>
					)}
				/>

			</FormControl>


			{isMirrored && <FormControl name="numberOfMirrors"
			                            label="Number of Mirrors"
			                            errorMessage={formState.errors?.numberOfMirrors?.message}>
				<Controller
					control={control}
					name="numberOfMirrors"
					defaultValue={volume.numberOfMirrors || 1}
					render={({ field: { onChange, value } }) => (
						<Select id="numberOfMirrors"
						        value={value}
						        onChange={val => onChange(parseInt(val))}
						        disabled={disabled}
						        options={consts.validNumberOfMirrors.map(n => ({
							        text: `${n} (${n + 1} copies)`,
							        value: n
						        }))}
						/>
					)}
				/>

			</FormControl>}

			{(isMirrored || isEC) && <FormControl name="protectionLevel"
			                      label="Target Node Redundancy"
			                      errorMessage={formState.errors?.protectionLevel?.message}>
				<Controller
					control={control}
					name="protectionLevel"
					value={volume.protectionLevel}
					rules={{
						required: 'Target Node Redundancy is required'
					}}
					render={({ field: { onChange, value } }) => {
						const redundancy = isEC ? formData.parityBlocks : formData.numberOfMirrors;
						const totalSegments = isEC ? formData.dataBlocks + formData.parityBlocks : formData.numberOfMirrors + 1;
						const requiredMirrorsMinimal = AllocationService.calcRequiredMirrorsBySeparation(
							consts.separationTypes.MINIMAL, totalSegments, redundancy);

						const options = [
							{
								value: consts.separationTypes.MINIMAL,
								name: 'N+1 Target Redundancy',
								description: `Up to two volume segments per target. Survive one target failure (min. ${requiredMirrorsMinimal} targets).`,
								order: 2
							},
							{
								value: consts.separationTypes.IGNORE,
								name: 'No Target Redundancy',
								description: 'No restriction on volume segments per target. May not survive even one target failure.',
								order: 3
							},
						];

						if (redundancy > 1) {
							const requiredMirrorsFull = AllocationService.calcRequiredMirrorsBySeparation(
								consts.separationTypes.FULL, totalSegments, redundancy);

							options.unshift({
								value: consts.separationTypes.FULL,
								name: `N+${redundancy} Target Redundancy`,
								description: `Only one volume segment per target. Survive up to ${redundancy} ` +
									`target failures (min. ${requiredMirrorsFull} targets).`,
								order: 1
							});
						}

						return (
							<Select id="protectionLevel"
							        value={value}
							        onChange={onChange}
							        disabled={disabled}
							        valueField="value"
							        labelField="name"
							        sortField={[
								        { field: 'order', direction: 'asc' },
							        ]}
							        options={options}
							        render={{
								        option: function(item, escape) {
									        return '<div>' +
										        '<strong>' + item.name + '</strong>' +
										        '<br/>' +
										        '<small>' + escape(item.description) + '</small>' +
										        '</div>';
								        }
							        }}
							/>
						);
					}}
				/>

				{isEC && <div>
					{formData.protectionLevel && formData.protectionLevel !== consts.separationTypes.FULL && formData.parityBlocks === 2 &&
						<i className="ion ion-alert-circled yellow"></i>
					}

					{formData.protectionLevel === consts.separationTypes.MINIMAL && formData.parityBlocks === 2 &&
						<i><small className="red">
							You are attempting to create a MeshProtect EC volume with dual drive failure redundancy but only 1
							target host failure redundancy</small></i>
					}
					{formData.protectionLevel === consts.separationTypes.IGNORE && formData.parityBlocks === 2 &&
						<i><small className="red">
							You are attempting to create a MeshProtect EC volume with drive failure redundancy, but with no
							protection against a target host failure</small></i>
					}
				</div>}
			</FormControl>}

			{isStriped && <FormControl name="stripeWidth"
			                           label="Stripe Width"
			                           errorMessage={formState.errors?.stripeWidth?.message}>
				<Input
					name="stripeWidth"
					className="form-control"
					placeholder="Enter Stripe width"
					type="number"
					min="2"
					max="128"
					disabled={disabled}
					{...register('stripeWidth', {
						value: volume.stripeWidth,
						valueAsNumber: true,
						min: {
							value: 2,
							message: 'Min value of 2'
						},
						max: {
							value: 128,
							message: 'Max value of 128'
						},
						validate: value => {
							if (formData.RAIDLevel === consts.RAIDLevel.STRIPED_RAID_0 && !value) return 'Stripe Width is required';
						}
					})}
				/>
			</FormControl>}

			{isEC && <FormControl name="dataBlocks"
			                      label="Data Blocks"
			                      errorMessage={formState.errors?.dataBlocks?.message}>
				<Input
					name="dataBlocks"
					className="form-control"
					placeholder="Enter Data Blocks"
					type="number"
					min="1"
					disabled={disabled}
					max={formData.parityBlocks === 2 ? 10 : 11}
					{...register('dataBlocks', {
						value: volume.dataBlocks,
						valueAsNumber: true,
						min: {
							value: 1,
							message: 'Min value of 1'
						},
						max: {
							value: formData.parityBlocks === 2 ? 10 : 11,
							message: `Max value of ${formData.parityBlocks === 2 ? 10 : 11}`
						},
						required: 'Data Blocks is required',
					})}
				/>
			</FormControl>}

			{isEC && <FormControl name="parityBlocks"
			                      label="Parity Blocks"
			                      errorMessage={formState.errors?.parityBlocks?.message}>
				<Input
					name="parityBlocks"
					className="form-control"
					placeholder="Enter Parity Blocks"
					type="number"
					min="1"
					max="2"
					disabled={disabled}
					{...register('parityBlocks', {
						value: volume.parityBlocks,
						valueAsNumber: true,
						min: {
							value: 1,
							message: 'Min value of 1'
						},
						max: {
							value: 2,
							message: 'Max value of 2'
						},
						required: 'Parity Blocks is required',
					})}
				/>
			</FormControl>}

			{isCRC && <div className="form-group aligned centred">
				<label>Enable CRC Check</label>
				<Controller
					control={control}
					name="enableCrcCheck"
					value={volume.enableCrcCheck}
					render={({ field: { onChange, value } }) => (
						<Toggle
							isChecked={value}
							onChange={onChange}
							disabled={isVpg}
						/>
					)}
				/>

			</div>}
		</div>
	);
};

export default VolumePRaidOptions;
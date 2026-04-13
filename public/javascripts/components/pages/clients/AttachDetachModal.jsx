/*
 * SPDX-FileCopyrightText: Copyright (c) 2026 NVIDIA CORPORATION & AFFILIATES. All rights reserved.
 * SPDX-License-Identifier: Apache-2.0
 */

/* global React, consts, ReactHookForm */

import FiltSortTable from '../../filtsort-table/FiltSortTable.jsx';
import { VolumesService } from '../../services/api/volumes.service.js';
import Modal from '../../core/Modal.jsx';
import Select from '../../core/Select.jsx';
import { useConfirmationDialog } from '../../shared/ConfirmationDialog.jsx';
import { isEqualSet, getProperty, difference, keyBy } from '../../utils.js';
import Checkbox from '../../core/Checkbox.jsx';

const { useState } = React;
const { useForm } = ReactHookForm;

const CreateAttachDetach = ({
	client,
	handleCancel = () => {},
	// eslint-disable-next-line no-unused-vars
	onSubmit = _ => {}
}) => {
	const [allVolumes, setAllVolumes] = useState({});
	const [volumesToAttach, setVolumesToAttach] = useState(new Set([]));
	const [volumesToDetach, setVolumesToDetach] = useState({});
	const [updatedVolumes, setUpdatedVolumes] = useState({});

	const [confirm] = useConfirmationDialog();

	const { handleSubmit } = useForm({ mode: 'all' });

	const initiallySelectedRows = Object.values(client.attachments)
		.filter(attachment => attachment.action === consts.volumeAttachmentActions.ATTACHING)
		.map(({ name, uuid }) => ({ _id: name, name, uuid }));
	const [selectedVolumes, setSelectedVolumes] = useState(keyBy(initiallySelectedRows, row => row.name));

	const initiallySelectedRowsNames = new Set(initiallySelectedRows.map(row => row.name));

	const loadRows = async(filter, sort, currentPage, count) => {
		filter = {
			...filter,
			isReady: true,
			type: { $ne: consts.volumeTypes.METADATA_VOLUME }
		};
		const projection = {
			name: 1,
			uuid: 1,
			volumeClass: 1,
			tpvConfig: 1,
			'reservation.mode': 1,
			'reservation.version': 1,
			'reservation.reservedBy': 1
		};
		const dbVolumes = await VolumesService.loadVolumes(filter, sort, currentPage, count, projection);
		dbVolumes.forEach(volume => {
			volume.reservation.mode = consts.reservationModesToName[volume.reservation.mode];
			volume.referenceIDs = new Set(client?.attachments[volume.uuid]?.referenceIDs || []);

			if (client.isUmClient)
				volume.emulation = {
					mode: consts.emulationModesToName[client.attachments[volume.uuid]?.emulation?.mode] || consts.emulationModeNames.NONE
				};

		});
		const volumesMap = keyBy(dbVolumes, volume => volume.name);
		setAllVolumes(prevVolumes => ({
			...prevVolumes,
			...volumesMap,
		  }));

		return dbVolumes;
	};

	const shouldVolumeBeAttached = updatedVolume => {
		const dbVolume = allVolumes[updatedVolume.name];
		const attachParameters = [
			'reservation.mode',
			'reservation.isDetachOthers',
			'emulation.mode',
		];

		return attachParameters.some(path => getProperty(updatedVolume, path) !== getProperty(dbVolume, path))
			|| !isEqualSet(updatedVolume.referenceIDs, dbVolume.referenceIDs);
	};

	const handleUpdatedVolume = (volume, updatedProperty, propertyName, isPropValueChanged) => {
		const volumeName = volume.name;
		let updatedVolume;

		if (isPropValueChanged) {
			const prevValue = getProperty(volume, propertyName);
			const newProperty = Object.assign({ [propertyName]: prevValue }, updatedProperty);
			updatedVolume = { ...volume, ...newProperty };
		} else {
			const originalProperty = { [propertyName]: allVolumes[volumeName][propertyName] };
			updatedVolume = { ...volume, ...originalProperty };
		}

		// Update the updatedVolumes map
		setUpdatedVolumes(prev => ({
			...prev,
			[volumeName]: updatedVolume
		}));

		const isSelected = selectedVolumes[volumeName];
		if (isSelected)
			handleVolumesToAttach(updatedVolume);

	};

	const handleVolumesToAttach = volume => {
		const volumeName = volume.name;

		// If volume is selected and there is a change from original attachment values, add it to volumesToAttach
		if (shouldVolumeBeAttached(volume))
			setVolumesToAttach(prev => prev.add(volumeName));
		else if (volumesToAttach.has(volumeName))
			setVolumesToAttach(prev => {
				const newVolumesToAttach = new Set(prev);
				newVolumesToAttach.delete(volumeName);
				return newVolumesToAttach;
			});
	};


	const checkSelectedReservationMode = async(volume, selectedReservationMode) => {
		const dbVolume = allVolumes[volume.name];
		const { reservation } = dbVolume;
		const isRequestingExclusiveWithDifferentClient = reservation.mode === consts.reservationModeNames.EXCLUSIVE_READ_WRITE
		&& reservation.reservedBy !== client.clientID;

		const reservationModeChanged = reservation.mode !== selectedReservationMode || isRequestingExclusiveWithDifferentClient;
		const shouldShowConfirmation = reservation.mode !== consts.reservationModeNames.NONE && reservationModeChanged;

		const isPreemptionConfirmed = () => confirm(
			`Warning: This operation requires preemption for the following volume: ${volume.name}\nPlease confirm.`
		  );

		const updatedReservation = { reservation: { mode: selectedReservationMode, version: reservation.version } };

		if (shouldShowConfirmation) {
			const confirmed = await isPreemptionConfirmed();
			if (!confirmed) return;
			updatedReservation.reservation.preempt = true;
		}

		handleUpdatedVolume(
			volume,
			updatedReservation,
			'reservation',
			reservationModeChanged
		);
	};

	const checkSelectedEmulationMode = (volume, selectedEmulationMode) => {
		const dbVolume = allVolumes[volume.name];
		const currentEmulationMode = dbVolume?.emulation?.mode;
		const isEmulationModeChanged = currentEmulationMode !== selectedEmulationMode;

		handleUpdatedVolume(
			volume,
			{ emulation: { mode: selectedEmulationMode } },
			'emulation',
			isEmulationModeChanged
		);
	};

	const checkSelectedRefID = (volume, selectedRefIDs) => {
		const volumeName = volume.name;
		const dbVolume = allVolumes[volumeName];
		const selectedRefIDsSet = new Set(selectedRefIDs);
		const isRefIDsChanged = !isEqualSet(dbVolume.referenceIDs, selectedRefIDsSet);

		handleUpdatedVolume(
			volume,
			{ referenceIDs: selectedRefIDsSet },
			'referenceIDs',
			isRefIDsChanged
		);

		if (!selectedRefIDs.length && volumesToAttach.has(volumeName)) {
			setVolumesToDetach(prevVolumes => ({
				...prevVolumes,
				[volumeName]: { name: volumeName, uuid: volume.uuid }
			}));
			setVolumesToAttach(prev => {
				const newSet = new Set(prev);
				newSet.delete(volumeName);
				return newSet;
			});
		}
	};

	const columns = [
		{
			name: 'Volume Name',
			field: 'name',
			placeholder: 'Search by Volume Name',
			sort: 'asc',
			value: volume => volume.name,
		},
		{
			name: 'CDV',
			field: 'cdvName',
			filterable: false,
			sortable: false,
			className: 'fixed-size-column lg-column',
			rowClassName: 'fixed-size-column lg-column',
			value: volume => volume.volumeClass === consts.volumeClass.TPV
				? (volume.tpvConfig?.cdvName || volume.tpvConfig?.cdvId || '')
				: '',
		},
		{
			name: 'Reservation Mode',
			field: 'reservationModeName',
			filterable: false,
			sortable: false,
			className: 'fixed-size-column lg-column',
			rowClassName: 'fixed-size-column lg-column',
			value: volume => {
				const reservationModeValue = updatedVolumes[volume.name]?.reservation?.mode || volume.reservation.mode;

				return <Select
					id={`reservation-mode-select-${volume.name}`}
					disabled={volume.isReadOnly}
					value={reservationModeValue === consts.reservationModeNames.NONE ? consts.reservationModeNames.SHARED_READ_WRITE : reservationModeValue}
					onChange={value => checkSelectedReservationMode(updatedVolumes[volume.name] || volume, value)}
					options={consts.reservationModeAttachOptions.map(modeName => ({ text: modeName, value: modeName }))}
				/>;
			}
		},
		{
			name: 'With Preempt',
			field: 'withPreempt',
			filterable: false,
			sortable: false,
			className: 'fixed-size-column',
			rowClassName: 'fixed-size-column',
			value: volume => {
				return <Checkbox
					id={`check-preempt-${volume.name}`}
					checked={!!updatedVolumes[volume.name]?.reservation?.preempt}
					disabled={true}
				/>;
			}
		},
		{
			name: 'Detach Other Clients',
			field: 'isDetachOthers',
			filterable: false,
			sortable: false,
			className: 'fixed-size-column',
			rowClassName: 'fixed-size-column',
			value: volume => {
				return <Checkbox
					id={`check-isDetachOthers-${volume.name}`}
					onChange={
						e => handleUpdatedVolume(
							updatedVolumes[volume.name] || volume,
							{ reservation: { ...updatedVolumes[volume.name].reservation, isDetachOthers: e.target.checked } },
							'reservation',
							true
						)
					}
					checked={!!updatedVolumes[volume.name]?.reservation?.isDetachOthers}
					disabled={!updatedVolumes[volume.name]?.reservation?.preempt}
				/>;
			}
		},
		{
			name: 'Reference IDs',
			field: 'referenceIDs',
			filterable: false,
			sortable: false,
			className: 'fixed-size-column md-column',
			value: volume => {
				const referenceIDs = Array.from(updatedVolumes[volume.name]?.referenceIDs || volume.referenceIDs);

				return <Select
					id={`ref-ids-${volume.name}`}
					value={referenceIDs}
					create={value => {
						const validateName = name => /^[a-z0-9-]{1,63}$/.test(name);
						if (!validateName(value)) {
							return false;
						}
						return { value: value, text: value };
					}}
					multiple
			        onChange={value => checkSelectedRefID(updatedVolumes[volume.name] || volume, value)}
			        options={referenceIDs.map((refID) => ({ text: refID, value: refID }))}
				/>;
			}
		},
		{
			name: 'Emulation Mode',
			field: 'emulationModeName',
			filterable: false,
			sortable: false,
			className: 'fixed-size-column md-column',
			value: volume => {
				let emulationModeValue = updatedVolumes[volume.name]?.emulation?.mode || volume?.emulation?.mode;

				if (client.isUmClient && !emulationModeValue)
					emulationModeValue = consts.emulationModeNames.NONE;

				return <Select
					id={`emulation-mode-select-${volume.name}`}
					disabled={!client.isUmClient}
					value={emulationModeValue}
					onChange={value => checkSelectedEmulationMode(updatedVolumes[volume.name] || volume, value)}
					options={Object.keys(consts.emulationModes).map(modeName => ({ text: modeName, value: modeName }))}
				/>;
			}
		}
	];

	function getRefIDsDifferences(dbRefIDs, selectedRefIDs) {
		// Elements in selectedRefIDs but not in currentRefIDs (added)
		const addedRefIDs = difference(selectedRefIDs, dbRefIDs);
		// Elements in currentRefIDs but not in selectedRefIDs (removed)
		const removedRefIDs = difference(dbRefIDs, selectedRefIDs);

		return { addedRefIDs, removedRefIDs };
	}

	function getAttachDetachRefIDsByVolumes(attachmentsMap) {
		return Object.keys(attachmentsMap).map(volumeName => {
			const dbRefIDs = allVolumes[volumeName].referenceIDs;
			const selectedRefIDs = attachmentsMap[volumeName].referenceIDs;

			return { volumeName, ...getRefIDsDifferences(dbRefIDs, selectedRefIDs) };
		}, {});
	}

	function populateAttachmentsAndDetachmentsForRefIDs(attachDetachRefIDs, attachmentsMap) {
		const refIdAttachments = [];
		const refIdDetachments = [];

		attachDetachRefIDs.forEach(({ volumeName, addedRefIDs, removedRefIDs }) => {
			let isRefIdAttach = false;
			let isRefIdDetach = false;

			addedRefIDs.forEach(refID => { isRefIdAttach = true; refIdAttachments.push({ ...attachmentsMap[volumeName], referenceID: refID }); });
			if (isRefIdAttach)
				delete attachmentsMap[volumeName];

			removedRefIDs.forEach(refID => {
				isRefIdDetach = true;
				refIdDetachments.push(volumesToDetach[volumeName]
					? { ...volumesToDetach[volumeName], referenceID: refID }
					: { name: volumeName, uuid: allVolumes[volumeName].uuid, referenceID: refID });
			});

			if (isRefIdDetach){
				if (volumesToDetach[volumeName])
					delete volumesToDetach[volumeName];
				if (attachmentsMap[volumeName])
					delete attachmentsMap[volumeName];
			}
		});

		return { refIdAttachments, refIdDetachments };
	}

	const setDefaultReservation = attachment => {
		if (attachment.reservation.mode === consts.reservationModeNames.NONE)
			attachment.reservation.mode = consts.reservationModeNames.SHARED_READ_WRITE;
	};

	const onFormSubmit = () => {
		const attachmentsMap = Object.fromEntries(Object.entries(updatedVolumes).filter(([key]) => volumesToAttach.has(key) || volumesToDetach[key]));
		const attachDetachRefIDs = getAttachDetachRefIDsByVolumes(attachmentsMap);
		const { refIdAttachments, refIdDetachments } = populateAttachmentsAndDetachmentsForRefIDs(attachDetachRefIDs, attachmentsMap);

		const attachments = [...Object.values(attachmentsMap), ...refIdAttachments];
		attachments.forEach(setDefaultReservation);
		const detachments = [...Object.values(volumesToDetach), ...refIdDetachments];

		onSubmit({ attachments, detachments });
	};

	const handleSelectedVolumes = async(currentlySelectedRows) => {
		const newSelectedNames = new Set(currentlySelectedRows.map(row => row.name));

		// Add newly selected volumes
		for (const volume of currentlySelectedRows) {
			const volumeName = volume.name;

			const isNewlySelected = !selectedVolumes[volumeName] && !initiallySelectedRowsNames.has(volumeName);
			if (isNewlySelected) {
				setVolumesToAttach(prev => new Set(prev).add(volumeName));
				await checkSelectedReservationMode(volume, volume.reservation.mode);
			} else if (volumesToDetach[volumeName]) {
				setVolumesToDetach(prevVolumes => {
					// eslint-disable-next-line no-unused-vars
					const { [volumeName]: _, ...newData } = prevVolumes;
					return newData;
				});
			}
		}

		// Handle unselected volumes
		Object.keys(selectedVolumes).forEach(volumeName => {
			const isNowUnselected = !newSelectedNames.has(volumeName);

			if (isNowUnselected && initiallySelectedRowsNames.has(volumeName)) {
				setVolumesToDetach(prevVolumes => ({
					...prevVolumes,
					[volumeName]: { name: volumeName, uuid: selectedVolumes[volumeName].uuid }
				}));
				setUpdatedVolumes(prev => ({
					...prev,
					[volumeName]: { ...(prev[volumeName] || {}), ...{ referenceIDs: new Set([]) } }
				}));
			} else if (isNowUnselected && volumesToAttach.has(volumeName)) {
				setVolumesToAttach(prev => {
					const newSet = new Set(prev);
					newSet.delete(volumeName);
					return newSet;
				});
			}
		});

		// Update the selectedVolumes map
		const newSelectedMap = Object.fromEntries(currentlySelectedRows.map(row => [row.name, row]));
		setSelectedVolumes(newSelectedMap);
	};


	return (
		<>
			<div className="modal-body">
				<form>
					<div className="fixed-size-column">
						<h3>{client.clientID}</h3>
					</div>
					<FiltSortTable tableId="attachDetachVolumes"
								   columns={columns}
								   loadTotal={VolumesService.loadTotal}
								   loadRows={loadRows}
								   queryParamsEnabled={false}
								   tableSettingsCache={{
									   enabled: false,
								   }}
								   multiselectOptions={{
							            enabled: true,
									    initiallySelectedRows: initiallySelectedRows,
							            onSelectedRowsChange: selectedRows => handleSelectedVolumes(selectedRows)
								   }}
					/>
				</form>
			</div>
			<div className="modal-footer">
				<button className="btn btn-primary mgmt-btn-primary"
					onClick={handleSubmit(onFormSubmit)}
					disabled={!Object.keys(volumesToDetach).length && !volumesToAttach.size}>
					Attach/Detach
				</button>
				<button className="btn btn-default" onClick={() => handleCancel()}>Cancel</button>
			</div>
		</>
	);
};

const AttachDetachModal = ({
	isOpen,
	client,
	handleCancel = () => {},
	// eslint-disable-next-line no-unused-vars
	onSubmit = _ => {}
}) => {

	return (
		<Modal
			isOpen={isOpen}
			disableBackdropClose
			onClose={() => handleCancel()}
			title="Attach/Detach Volumes"
			className="modal-lg">

			{client && <CreateAttachDetach
				client={client}
				handleCancel={handleCancel}
				onSubmit={onSubmit}
			/>}
		</Modal>
	);
};

export default AttachDetachModal;
/*
 * SPDX-FileCopyrightText: Copyright (c) 2026 NVIDIA CORPORATION & AFFILIATES. All rights reserved.
 * SPDX-License-Identifier: Apache-2.0
 */

/* global React, consts */

import { AllocationService } from '../../services/allocation.service.js';
import CapacityService from '../../services/capacity.service.js';
import { useAppContext } from '../App.jsx';

const getRedundancyUnitsCount = (pRaidOptions) => {
	if (AllocationService.isMirrored(pRaidOptions.RAIDLevel)) {
		return pRaidOptions.numberOfMirrors || 1;
	}
	if (AllocationService.isEC(pRaidOptions.RAIDLevel)) {
		return pRaidOptions.parityBlocks || 0;
	}
	return 0;
};

const getRedundancyUnitPercentage = (pRaidOptions, dataPercentage) => {
	if (AllocationService.isMirrored(pRaidOptions.RAIDLevel)) {
		return dataPercentage;
	}
	if (AllocationService.isEC(pRaidOptions.RAIDLevel)) {
		return Math.round((dataPercentage / (pRaidOptions.dataBlocks || 1)) * 100) / 100;
	}

	return 0;
};

const VolumeAllocationBar = ({
	pRaidOptions,
	volumeAllocatedCapacity,
	totalSpace,
	allocatedSpace,
	currentCapacity = 0
}) => {
	const { unitType } = useAppContext();
	const usedSpacePercentage = Math.round((allocatedSpace / totalSpace) * 10000) / 100;
	const redundancyUnitsCount = getRedundancyUnitsCount(pRaidOptions);
	const spaceToAllocatePercentage = (Math.round(((currentCapacity - volumeAllocatedCapacity) / totalSpace) * 10000) / 100) || 0;
	const spaceToAllocate = CapacityService.toBiggestUnit((currentCapacity - volumeAllocatedCapacity), unitType);
	const redundancyUnitPercentage = getRedundancyUnitPercentage(pRaidOptions, spaceToAllocatePercentage);
	const redundancyPercentage = redundancyUnitPercentage * redundancyUnitsCount;
	const freePercentage = Math.round((100 - (redundancyPercentage + spaceToAllocatePercentage + usedSpacePercentage)) * 100) / 100;
	const redundancyType = pRaidOptions.RAIDLevel === consts.RAIDLevel.ERASURE_CODING ? 'Parity' : 'Mirror';

	return (
		<div className="progress">
			<div className="progress-bar progress-bar-info" style={{ width: `${spaceToAllocatePercentage}%` }}>
				{spaceToAllocatePercentage}% ({spaceToAllocate})
			</div>
			{[...Array(redundancyUnitsCount)].map((_, index) => (
				<div key={index} className="progress-bar progress-bar-striped progress-bar-mirror" style={{ width: `${redundancyUnitPercentage}%` }}>
					{redundancyType} #{index + 1}
				</div>
			))}
			<div className="progress-bar progress-bar-success" style={{ width: `${freePercentage}%` }}>
				{freePercentage}% Free
			</div>
			<div className="progress-bar progress-bar-striped progress-bar-danger" style={{ width: `${usedSpacePercentage}%` }}>
				{usedSpacePercentage}% Used
			</div>
		</div>
	);
};

export default VolumeAllocationBar;

/*
 * SPDX-FileCopyrightText: Copyright (c) 2026 NVIDIA CORPORATION & AFFILIATES. All rights reserved.
 * SPDX-License-Identifier: Apache-2.0
 */

/* global React*/

import { useAppContext } from '../../App.jsx';
import CapacityService from '../../services/capacity.service.js';

const CapacityDisplay = ({
	disk
}) => {
	const { unitType } = useAppContext();

	const usedBlocks = disk.usableBlocks === 0 ? 0 : (disk.usableBlocks - disk.availableBlocks) * 4096;
	const totalBytes = disk.usableBlocks * 4096;

	const percent = Math.round((usedBlocks / totalBytes) * 100);
	const humanUsedBytes = CapacityService.toBiggestUnit(usedBlocks, unitType, { fromBytes: true, trunc: true });
	const humanTotalBytes = CapacityService.toBiggestUnit(totalBytes, unitType, { fromBytes: true, trunc: true });

	return	<span>{`${humanUsedBytes}/${humanTotalBytes} (${percent}%)`}</span>;
};

export default CapacityDisplay;
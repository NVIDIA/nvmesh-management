/*
 * SPDX-FileCopyrightText: Copyright (c) 2026 NVIDIA CORPORATION & AFFILIATES. All rights reserved.
 * SPDX-License-Identifier: Apache-2.0
 */

/* global React */

import CapacityService from '../../services/capacity.service.js';
import { toPercent } from '../../utils.js';
import { useAppContext } from '../../App.jsx';

const LargestVolumes = ({ volumes, totalCapacity }) => {
	const { unitType } = useAppContext();

	return (
		<div id="progressContainer">

			{volumes.map((volume, index) => (
				<div className="progress-group" key={index}>
					<span className="progress-text">{volume.name}</span>
					<span className="progress-number">
						<b>{CapacityService.toBiggestUnit(volume.capacity, unitType)}</b>/{CapacityService.toBiggestUnit(totalCapacity, unitType)}
					</span>
					<div className="progress sm">
						<div className="progress-bar progress-bar-aqua"
						     style={{ width: `${toPercent(volume.capacity, totalCapacity)}%` }}
						></div>
					</div>
				</div>
			))}
		</div>
	);
};

export default LargestVolumes; 
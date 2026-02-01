/*
 * SPDX-FileCopyrightText: Copyright (c) 2026 NVIDIA CORPORATION & AFFILIATES. All rights reserved.
 * SPDX-License-Identifier: Apache-2.0
 */

/* global React, c3, STATUS_COLORS */

import CapacityService from '../../services/capacity.service.js';
import { useAppContext } from '../App.jsx';
import { toPercent } from '../../utils.js';

const { useEffect, useRef } = React;

const AllocationChart = ({
	volumeSpace,
	redundancySpace,
	freeSpace,
	totalSpace,
}) => {
	const { unitType } = useAppContext();
	const chartRef = useRef(null);
	const chart = useRef(null);

	const columns = [
		['Volume Space', volumeSpace],
		['Redundancy Space', redundancySpace],
		['Free Space', freeSpace]
	];

	useEffect(() => {
		if (chart.current) {
			chart.current.load({
				columns
			});
		} else {
			initGraph();
		}

	}, [volumeSpace, redundancySpace, freeSpace]);

	const initGraph = () => {
		chart.current = c3.generate({
			bindto: chartRef.current,
			data: {
				columns,
				type: 'donut',
				colors: {
					'Volume Space': STATUS_COLORS.NORMAL,
					'Redundancy Space': STATUS_COLORS.ACTION,
					'Free Space': STATUS_COLORS.PLACEHOLDER,
				},
				order: null
			},
			donut: {
				width: 7,
				label: {
					show: false
				}
			},
			tooltip: {
				format: {
					value: value => CapacityService.toBiggestUnit(value, unitType)
				}
			}
		});
	};


	return (
		<div id="capacityChartContainer">
			<div id="capacityChart" className="capacity-chart" ref={chartRef}></div>

			<div id="capacityChartLabelsContainer">
				<span>{toPercent(redundancySpace, totalSpace)}%<br/>
					<span>
						{CapacityService.toBiggestUnit(redundancySpace, unitType)} / {CapacityService.toBiggestUnit(totalSpace, unitType)}<br/>
						<b>Redundancy</b>
					</span>
				</span>
				<span>{toPercent(volumeSpace, totalSpace)}%<br/>
					<span>
						<b>Volumes</b>
						{CapacityService.toBiggestUnit(volumeSpace, unitType)} / {CapacityService.toBiggestUnit(totalSpace, unitType)}<br/>
					</span>
				</span>
				<span>{toPercent(freeSpace, totalSpace)}%<br/>
					<span>
						{CapacityService.toBiggestUnit(freeSpace, unitType)} / {CapacityService.toBiggestUnit(totalSpace, unitType)}<br/>
						<b>Free Space</b>
					</span>
				</span>
			</div>
			<div className="icon-container">
				<i className="ion ion-cloud"></i>
			</div>
		</div>

	);
};

export default AllocationChart;

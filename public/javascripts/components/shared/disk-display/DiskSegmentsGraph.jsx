/*
 * SPDX-FileCopyrightText: Copyright (c) 2026 NVIDIA CORPORATION & AFFILIATES. All rights reserved.
 * SPDX-License-Identifier: Apache-2.0
 */

/* global React, consts, c3, d3, $ */

import { VolumesService } from '../../services/api/volumes.service.js';
import { keyBy } from '../../utils.js';
import { DiskUtilsService } from '../../services/disk-utils.service.js';
import SegmentsModal from './SegmentsModal.jsx';

const { useRef, useState, useEffect } = React;

const DiskSegmentsGraph = ({
	disk,
	volumeName
}) => {
	const c3Chart = useRef(null);
	const chartRef = useRef(null);
	const [isSegmentsModalOpen, setIsSegmentsModalOpen] = useState(false);
	const [segmentsFilter, setSegmentsFilter] = useState({});
	const segmentsMap = {};
	let segmentsById = {};

	useEffect(() => {
		init();
	}, [disk]);

	function showSegmentsModal(minLbs, maxlbe) {
		const filter = {
			'disks.diskSegments.lbs': { $gte: minLbs },
			'disks.diskSegments.lbe': { $lte: maxlbe }
		};

		setSegmentsFilter(filter);
		setIsSegmentsModalOpen(true);
	}

	const isSpacerSegment = (segment) => segment.id.indexOf('spacer') > -1;

	async function init() {
		const diskSegments = {};

		disk.diskSegments?.forEach(segment => {
			if (segment.type !== consts.segmentTypes.EXCELERO_METADATA) {
				diskSegments[segment.uuid] = segment;
			}
		});

		if (Object.keys(diskSegments).length) {
			const params = { nodeID: disk.nodeID, diskID: disk.diskID };
			const res = await VolumesService.getSegmentsStatusByDisk(params);

			Object.entries(res).forEach(([segID, data]) => {
				if (diskSegments[segID])
					diskSegments[segID] = data;
			});
		}

		let segments = DiskUtilsService.getSegments(disk);
		segments = segments.map(segment => ({ ...segment, ...diskSegments[segment.id] }));

		segmentsById = keyBy(segments, s => s.id);

		const chartData = DiskUtilsService.processDiskSegments(segments, disk.usableBlocks, segmentsMap);

		if (c3Chart.current) {
			c3Chart.current.load({
				columns: chartData.data,
				colors: chartData.colors
			});
		} else {
			initGraph(chartData);
		}
	}

	function initGraph(chartData) {
		c3Chart.current = c3.generate({
			size: {
				width: 350,
				height: 350
			},
			bindto: chartRef.current,
			data: {
				type: 'donut',
				order: null,
				columns: chartData.data,
				colors: chartData.colors,
				onmouseover: (d, e) => {
					if (isSpacerSegment(d)) {
						$(chartRef.current).find('g.c3-chart-arc').attr('style', 'opacity:1 !important');

						d3
							.select(e)
							.transition()
							.attr('d', d3.select(e).attr('d'));
					}
				},
				onmouseout: () => {
					$(chartRef.current).find(' g.c3-chart-arc').attr('style', '');

					setTimeout(highlightVolumeSegments, 50);
				},
				onclick: d => {
					const segment = segmentsById[d.id];
					if (segment.isPlaceHolder) return;

					let minLbs = -1;
					let maxlbe = 0;
					//create lbs-lbe filter
					for (const id in segmentsMap[d.id]) {
	 					const segment = segmentsMap[d.id][id];

						if (maxlbe < segment.lbe)
							maxlbe = segment.lbe;

						if (minLbs > segment.lbs || minLbs === -1)
							minLbs = segment.lbs;
					}

					// show segments modal
					showSegmentsModal(minLbs, maxlbe);
				}
			},
			legend: {
				show: false
			},
			donut: {
				width: 30,
				label: {
					show: false
				}
			},
			tooltip: {
				format: {},
				contents: d => {
					const segment = segmentsById[d[0].id];
					return segment.isPlaceHolder ? '' : getSegmentTooltipHTML(segment);
				},
				position: function(d, e, r, shape) {
					const position = c3.chart.internal.fn.tooltipPosition.apply(this, arguments);

					if (d3.mouse(shape)[0] > 0)
						position.left -= 130;

					return position;
				}
			},
			onrendered: () => {
				setTimeout(() => {
					if (!volumeName)
						return false;

					highlightVolumeSegments();
				}, 50);
			}
		});
	}

	function highlightVolumeSegments() {
		if (!disk.diskSegments || !disk.diskSegments.length) return;

		const volumeSegments = disk.diskSegments.filter(ds => ds.volumeName && ds.volumeName === volumeName);

		volumeSegments.forEach(segment => {
			const e = d3.select('.c3-arc-' + segment._id)[0][0];
			if (!e)
				return;

			const outerRadius = getOuterRadiusFromArc(e);
			const innerRadius = getInnerRadiusFromArc(e);

			const arc = d3.svg.arc(e);
			arc.innerRadius(innerRadius);
			arc.outerRadius(outerRadius + 5);

			d3.select(e).attr('d', arc);
		});
	}

	function getOuterRadiusFromArc(arc) {
		const numbersInPattern = _getArcNumbers(arc);

		return Math.max.apply(null, numbersInPattern);
	}

	function getInnerRadiusFromArc(arc) {
		const numbersInPattern = _getArcNumbers(arc);

		if (numbersInPattern.length < 4) return 0;

		return Math.min.apply(null, numbersInPattern);
	}

	function _getArcNumbers(arc) {
		const pathDescription = arc.getAttribute('d');

		const numberRegExp = /[-+]?[0-9]*\.?[0-9]+([eE][-+]?[0-9]+)?/g;
		const arcPattern = new RegExp('A' + numberRegExp.source + ',' + numberRegExp.source, 'g');
		const arcParameters = pathDescription.match(arcPattern);

		let numbersInPattern = [];

		for (let parameterIndex = 0; parameterIndex < arcParameters.length; parameterIndex++) {
			const parameter = arcParameters[parameterIndex];

			const numbers = parameter.match(numberRegExp);

			if (numbers !== null)
				numbersInPattern = numbersInPattern.concat(numbers);
		}

		numbersInPattern = numbersInPattern.map(numberString => parseFloat(numberString));

		return numbersInPattern;
	}


	function getSegmentTooltipHTML(segment) {
		const segmentCounts = {
			numOfNormal: 0,
			numOfDead: 0,
			numOfUnderRecovery: 0,
			numOfReserved: 0,
			numOfSegments: 0
		};

		Object.values(segmentsMap[segment.id]).forEach(segment => {
			if (segment.isPlaceHolder) return;

			segmentCounts.numOfSegments++;
			if (segment.isDead) {
				segmentCounts.numOfDead++;
			} else if (segment.status === consts.diskSegmentStatuses.NORMAL) {
				segmentCounts.numOfNormal++;
			} else if (segment.isReserved) {
				segmentCounts.numOfReserved++;
			} else {
				segmentCounts.numOfUnderRecovery++;
			}
		});

		return `<div class="popover segment-popover" style="display: block">
			<div class="segment-popover-body">
				<h3>${segmentCounts.numOfSegments} segment(s)</h3>
				<table>
					<tr>
						<td>Normal</td>
						<td>${segmentCounts.numOfNormal}</td>
					</tr>
					<tr>
						<td>Dead</td>
						<td>${segmentCounts.numOfDead}</td>
					</tr>
					<tr>
						<td>Under recovery</td>
						<td>${segmentCounts.numOfUnderRecovery}</td>
					</tr>
					<tr>
						<td>Reserved</td>
						<td>${segmentCounts.numOfReserved}</td>
					</tr>
				</table>
				<div class="segment-popover-footer">click for more info</div>
			</div>
		</div>`;
	}

	return (
		<>
			<div className="disk-display" id={`diskDisplay_${disk.uuid}`} ref={chartRef}></div>

			<SegmentsModal isOpen={isSegmentsModalOpen}
			               diskId={disk.diskID}
			               serverId={disk.nodeID}
			               segmentsFilter={segmentsFilter}
			               handleCancel={() => setIsSegmentsModalOpen(false)}/>
		</>
	);
};


export default DiskSegmentsGraph;
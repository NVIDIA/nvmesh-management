/* global React, consts */

import { AppContext } from '../../../App.jsx';
import CapacityService from '../../../services/capacity.service.js';
import { OverlayTrigger, Popover } from '../../../core/Popover.jsx';

const { useContext } = React;

const segmentStatusToCaption = (status) => {
	const segmentStatusToCaptionMap = {
		[consts.diskSegmentStatuses.NORMAL]: 'Normal',
		[consts.diskSegmentStatuses.INITIALIZING]: 'Initializing',
		[consts.diskSegmentStatuses.ZEROING]: 'Zeroing',
		[consts.diskSegmentStatuses.MARKED_FOR_REBUILD_OLD]: 'Marked For Rebuild Old',
		[consts.diskSegmentStatuses.MARKED_FOR_REBUILD]: 'Marked For Rebuild',
		[consts.diskSegmentStatuses.REMAP]: 'Remap',
		[consts.diskSegmentStatuses.UNDER_RECOVERY_TOMA]: 'Under Recovery',
		[consts.diskSegmentStatuses.REPLACEMENT]: 'Replacement',
		[consts.diskSegmentStatuses.DEPRECATED]: 'Deprecated',
		[consts.diskSegmentStatuses.DEAD]: 'Dead',
		[consts.diskSegmentStatuses.BOOTING]: 'Booting'
	};

	return segmentStatusToCaptionMap[status] || status;
};

const segmentStatusToHealth = (status) => {
	if (status === consts.diskSegmentStatuses.NORMAL) {
		return 'green';
	} else if ([
		consts.diskSegmentStatuses.INITIALIZING,
		consts.diskSegmentStatuses.ZEROING,
		consts.diskSegmentStatuses.MARKED_FOR_REBUILD_OLD,
		consts.diskSegmentStatuses.MARKED_FOR_REBUILD
	].includes(status)) {
		return 'primary';
	} else if ([
		consts.diskSegmentStatuses.REMAP,
		consts.diskSegmentStatuses.UNDER_RECOVERY_TOMA,
		consts.diskSegmentStatuses.REPLACEMENT
	].includes(status)) {
		return 'yellow';
	} else if ([
		consts.diskSegmentStatuses.DEPRECATED,
		consts.diskSegmentStatuses.DEAD,
		consts.diskSegmentStatuses.BOOTING
	].includes(status)) {
		return 'red';
	}
};

const VolumeDiagramSegment = ({
	diskSegment
}) => {

	const { unitType } = useContext(AppContext);
	const total = (diskSegment.lbe - diskSegment.lbs !== 0 ? diskSegment.lbe - diskSegment.lbs + 1 : 0) * 4096;

	const popover = (
		<Popover className="segment-popover tile-tooltip">
			<div className="segment-popover-body">
				<h3>Partition</h3>
				<table>
					<tbody>
						<tr>
							<td><strong>UUID:</strong></td>
							<td>{diskSegment.uuid}</td>
						</tr>
						<tr>
							<td><strong>Volume:</strong></td>
							<td>{diskSegment.volumeName}</td>
						</tr>
						<tr>
							<td><strong>LBS:</strong></td>
							<td>{diskSegment.lbs}</td>
						</tr>
						<tr>
							<td><strong>LBE:</strong></td>
							<td>{diskSegment.lbe}</td>
						</tr>
						<tr>
							<td><strong>Status:</strong></td>
							<td>
								<label
									className={`label mr-5 bg-${segmentStatusToHealth(diskSegment.status)}`}>
									{segmentStatusToCaption(diskSegment.status)}
								</label>
								<i className="fa fa-info-circle blue"
								   title={segmentStatusToCaption(diskSegment.status)}></i>
							</td>
						</tr>
						<tr>
							<td><strong>Drive ID:</strong></td>
							<td>{diskSegment.diskID}</td>
						</tr>
						<tr>
							<td><strong>Target ID:</strong></td>
							<td>{diskSegment.node_id}</td>
						</tr>
					</tbody>
				</table>

			</div>
			<div className="segment-popover-footer" style={{ padding: '9px' }}>
				Total: {diskSegment.lbe - diskSegment.lbs !== 0 ? diskSegment.lbe - diskSegment.lbs + 1 : 0} &nbsp;
				<div style={{ display: 'inline-block' }}>
					<label className="label label-info">{CapacityService.toBiggestUnit(total, unitType, { fromBytes: true })}</label>
				</div>
			</div>
		</Popover>
	);

	return (
		<OverlayTrigger trigger="hover" overlay={popover}>
			<div className={`tile-item tile-item-${segmentStatusToHealth(diskSegment.status)}`}></div>
		</OverlayTrigger>
	);
};


export default VolumeDiagramSegment;
/* global React, consts, $ */

import CapacityService from '../../services/capacity.service.js';
import { useAppContext } from '../../App.jsx';
import { DisksService } from '../../services/api/disks.service.js';
import { useAlerts } from '../../core/Alert.jsx';
import { useConfirmationDialog } from '../ConfirmationDialog.jsx';
import { extractResults } from '../../utils.js';
import DiskSegmentsGraph from './DiskSegmentsGraph.jsx';
import { DiskUtilsService } from '../../services/disk-utils.service.js';
import { events, SocketService } from '../../services/socket.service.js';
import DriveHealthIcon from '../../pages/drives/DriveHealthIcon.jsx';

const { useState, useEffect } = React;

const DiskDisplay = ({
	disk,
	target,
	expanded = false
}) => {
	const { currUser, unitType } = useAppContext();
	const [confirm] = useConfirmationDialog();
	const { successAlert, errorAlert } = useAlerts();
	const [isExpanded, setIsExpanded] = useState(expanded);
	const [diskToDisplay, setDiskToDisplay] = useState(disk);

	useEffect(() => {
		SocketService.addHandler(SocketService.getDiskID(diskToDisplay.diskID) + events.diskEvictedEvent.name, ({ payload }) => {
			setDiskToDisplay(prev => ({ ...prev, isOutOfService: true }));
			if (payload?.automaticallyEvicted) {
				setDiskToDisplay(prev => ({ ...prev, automaticallyEvicted: true }));
			}
		});
	}, []);

	useEffect(() => {
		setIsExpanded(expanded);
	}, [expanded]);

	useEffect(() => {
		setDiskToDisplay(disk);
	}, [disk]);

	const deleteDisk = async(disk) => {
		const confirmed = await confirm(`You're going to delete drive: ${disk.diskID}. are you sure?`);
		if (!confirmed) {
			return;
		}

		const responses = await DisksService.deleteDisks([{ _id: disk.diskID, uuid: disk.uuid }]);
		const responsesBySuccess = extractResults(responses);

		if (responsesBySuccess.success.length) {
			successAlert(`Drive ${disk.diskID} deleted successfully`, { attachToRoot: true });
		}
		Object.keys(responsesBySuccess.failed).forEach(errorMsg => {
			errorAlert(`Failed to delete Drive ${disk.diskID} - ${errorMsg}`, { attachToRoot: true });
		});
	};

	const formatDisk = async(disk) => {
		let confirmText = 'Warning: You are about to format the drive. Formatting will erase all the data on this drive.';

		if (disk && disk.status === consts.diskStatus.NOT_INITIALIZED &&
			disk.GPT && disk.GPT.isValid && disk.GPT.entries && disk.GPT.entries.length) {
			confirmText = 'Warning: Drive already contains other partitions. This operation will delete the existing partitions and is irreversible.';
		}

		const confirmed = await confirm(confirmText, true);
		if (!confirmed) {
			return;
		}

		const responses = await DisksService.formatDisks([{ _id: disk.diskID, uuid: disk.uuid }]);
		const responsesBySuccess = extractResults(responses);

		if (responsesBySuccess.success.length) {
			successAlert(`Drive ${disk.diskID} formatting command sent`, { attachToRoot: true });

			setDiskToDisplay(prev => ({ ...prev, isPendingFormat: true }));

			if (disk.isOutOfService) {
				setDiskToDisplay(prev => ({ ...prev, isOutOfService: false, automaticallyEvicted: undefined, autoEvictReason: undefined }));
			}
		}
		Object.keys(responsesBySuccess.failed).forEach(errorMsg => {
			errorAlert(`Failed to format Drive ${disk.diskID} - ${errorMsg}`, { attachToRoot: true });
		});
	};

	const evictDisk = async(disk) => {
		const { diskID } = disk;
		const { allowEvict, shouldShowConfirm, msg } = await DiskUtilsService.validateEvictAction([disk]);

		if (!allowEvict) {
			return errorAlert(msg, { attachToRoot: true });
		}

		if (shouldShowConfirm) {
			const confirmed = await confirm(msg);
			if (!confirmed) {
				return;
			}
		}

		const responses = await DisksService.evictDisks([disk]);
		const responsesBySuccess = extractResults(responses);

		if (responsesBySuccess.success.length) {
			successAlert(`Drive ${diskID} evicted successfully`, { attachToRoot: true });

			setDiskToDisplay(prev => ({ ...prev, isOutOfService: true }));
			setDiskToDisplay(prev => {
				const updatedDiskSegments = prev.diskSegments?.map(ds => {
					if (!ds.owner || (ds.owner === consts.segmentOwners.NVMESH && ds.type !== consts.segmentTypes.EXCELERO_METADATA)) {
						return { ...ds, status: 'remap' };
					}
					return ds;
				});
				return { ...prev, diskSegments: updatedDiskSegments };
			});

			$('.disk[data-diskid="' + diskID + '"] .progress-bar:not(".progress-bar-success")')
				.attr('class', 'progress-bar progress-bar-striped');
		}
		Object.keys(responsesBySuccess.failed).forEach(errorMsg => {
			errorAlert(`Failed to evict Drive ${diskID} - ${errorMsg}`, { attachToRoot: true });
		});

	};

	if (!isExpanded) {
		return (
			<div className={`btn-circle ${DiskUtilsService.getDiskHealthClass(diskToDisplay)}`}
			     onClick={() => setIsExpanded(true)}
			     title={diskToDisplay.diskID}></div>
		);
	}

	return (
		<div className="disk-display-container">
			<div className="icon">
				<DriveHealthIcon drive={diskToDisplay}/>
			</div>
			<div className="disk-icon">
				<i className="fa fa-hdd-o"/>
			</div>
			{!diskToDisplay.isOutOfService && !diskToDisplay.isPendingFormat && diskToDisplay.status === consts.diskStatus.INITIALIZING && (
				<div className="status-progress">
					<strong>
						<div>{DiskUtilsService.getDiskHealthMessage(diskToDisplay)}</div>
					</strong>
					<span>{diskToDisplay.nZeroedBlks ? Math.round(diskToDisplay.nZeroedBlks * 100 / diskToDisplay.blocks) : 0}%</span>
				</div>
			)}
			<span>{diskToDisplay.usableBlocks === 0 ? 0 : ((100 - Math.round(diskToDisplay.availableBlocks / diskToDisplay.usableBlocks * 100)) || 0)}%<br/>
				<span>
					{!diskToDisplay.usableBlocks && 0}
					{diskToDisplay.usableBlocks &&
						CapacityService.toBiggestUnit((diskToDisplay.usableBlocks - diskToDisplay.availableBlocks) * 4096, unitType, {
							fromBytes: true
						})}
					{`/${CapacityService.toBiggestUnit(diskToDisplay.usableBlocks * 4096, unitType, { fromBytes: true })} Allocated`}
				</span>
			</span>
			<div className="disk-statistics">
				<h4 className="box-header with-border">
					<span className={diskToDisplay.status === consts.diskStatus.NOT_INITIALIZED || diskToDisplay.isExcluded ? 'disabled-link' : ''}>
						{diskToDisplay.diskID}
					</span>
				</h4>
				<small>{DiskUtilsService.modelToDisplayString(diskToDisplay.Model)} </small>
				<br/>
				<div className="btn-group">
					<button type="button"
					        className="btn btn-danger mgmt-btn-danger btn-sm"
					        disabled={!currUser.isAdmin ||
						        (diskToDisplay.status === consts.diskStatus.NOT_INITIALIZED && !DiskUtilsService.hasVolumeSegments(diskToDisplay) ||
							        diskToDisplay.isExcluded || diskToDisplay.isOutOfService)}
					        onClick={() => evictDisk(diskToDisplay)} data-dismiss="modal">
						Evict
					</button>
					{!(diskToDisplay.status === consts.diskStatus.NOT_INITIALIZED ||
							(diskToDisplay.isExcluded && diskToDisplay.status !== consts.diskStatus.MISSING)) &&
						<button type="button"
						        className="btn btn-danger mgmt-btn-danger btn-sm"
						        disabled={!currUser.isAdmin || !DiskUtilsService.isDriveDeletable(target, diskToDisplay)}
						        onClick={() => deleteDisk(diskToDisplay)}>
							Del
						</button>}
					<button type="button"
					        className="btn btn-danger mgmt-btn-danger btn-sm dropdown-toggle"
					        onClick={() => formatDisk(diskToDisplay)}
					        disabled={!currUser.isAdmin ||
						        (diskToDisplay.status === consts.diskStatus.MISSING || diskToDisplay.isExcluded ||
							        DiskUtilsService.hasVolumeSegments(diskToDisplay) || !target.zone)}>
						Format
						{diskToDisplay.status === consts.diskStatus.FROZEN ||
							diskToDisplay.status === consts.diskStatus.FORMATTING || diskToDisplay.isPendingFormat &&
							<i className="fa fa-cog fa-spin"></i>}
					</button>
				</div>
			</div>

			<DiskSegmentsGraph disk={diskToDisplay}/>

		</div>
	);
};


export default DiskDisplay;
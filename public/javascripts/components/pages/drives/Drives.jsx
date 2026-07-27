/* global React, consts */

import { useAppContext } from '../App.jsx';
import { useAlerts } from '../../core/Alert.jsx';
import { useConfirmationDialog } from '../../shared/ConfirmationDialog.jsx';
import FiltSortTable from '../../filtsort-table/FiltSortTable.jsx';
import { SocketService, events } from '../../services/socket.service.js';
import { DisksService } from '../../services/api/disks.service.js';
import CapacityService from '../../services/capacity.service.js';
import DriveHealthIcon from './DriveHealthIcon.jsx';
import { DiskUtilsService } from '../../services/disk-utils.service.js';
import { extractResults } from '../../utils.js';

const { useRef, useState, useEffect } = React;

const diskToCapacity = (server, unitType) => {
	const used = server.disks.usableBlocks === 0 ? 0 : CapacityService.toBiggestUnit((
		server.disks.usableBlocks - server.disks.availableBlocks) * 4096, unitType, { fromBytes: true });
	const total = CapacityService.toBiggestUnit(server.disks.usableBlocks * 4096, unitType, { fromBytes: true });
	const percentage = server.disks.usableBlocks === 0 ? 0 : ((100 - Math.round(server.disks.availableBlocks / server.disks.usableBlocks * 100)) || 0);

	return `${used}/${total} (${percentage}%)`;
};

const Drives = () => {
	const tableRef = useRef();
	const { successAlert, errorAlert } = useAlerts();
	const [confirm] = useConfirmationDialog();
	const { currUser, unitType } = useAppContext();
	const [selectedDrives, setSelectedDrives] = useState([]);

	useEffect(() => {
		SocketService.addHandler(events.newDiskEvent.name, () => {
			reloadTable();
		});
	}, []);

	const reloadTable = () => {
		if (tableRef.current) {
			tableRef.current.reloadRows();
			tableRef.current.reloadTotal();
		}
	};

	const columns = [
		{
			name: 'Target',
			field: 'node_id',
			placeholder: 'Search by Target ID',
			sort: 'asc',
			className: 'fixed-size-column md-column',
			rowClassName: 'fixed-size-column',
			value: drive => <a href={`/servers/server/${drive.node_id}`}>{drive.node_id}</a>
		},
		{
			name: 'SN',
			field: 'disks.Serial_Number',
			placeholder: 'Search by Serial Number',
			className: 'fixed-size-column md-column',
			rowClassName: 'fixed-size-column',
			value: drive => drive.disks.Serial_Number
		},
		{
			name: 'Vendor',
			field: 'disks.Vendor',
			placeholder: 'Search by Vendor',
			className: 'fixed-size-column sx-column',
			rowClassName: 'fixed-size-column',
			value: drive => drive.disks.Vendor
		},
		{
			name: 'Model',
			field: 'disks.Model',
			placeholder: 'Search by Model',
			className: 'fixed-size-column',
			rowClassName: 'fixed-size-column',
			value: drive => DiskUtilsService.modelToDisplayString(drive.disks.Model)
		},
		{
			name: 'Capacity',
			field: 'disks.availableBlocks',
			className: 'fixed-size-column lg-column',
			filterable: false,
			rowClassName: 'fixed-size-column',
			value: server => diskToCapacity(server, unitType)
		},
		{
			name: 'Block Size',
			field: 'disks.block_size',
			className: 'fixed-size-column sx-column',
			filterable: false,
			sortable: false,
			rowClassName: 'fixed-size-column',
			value: drive => CapacityService.toBiggestUnit(drive.disks.block_size, unitType, { fromBytes: true, trunc: true })
		},
		{
			name: 'Metadata Size',
			field: 'disks.metadata_size',
			className: 'fixed-size-column md-column',
			filterable: false,
			sortable: false,
			rowClassName: 'fixed-size-column',
			value: drive => CapacityService.toBiggestUnit(drive.disks.metadata_size, unitType, { fromBytes: true, trunc: true })
		},
		{
			name: 'Status',
			field: 'disks.status',
			placeholder: 'Search by Status',
			className: 'fixed-size-column sx-column',
			rowClassName: 'fixed-size-ellipsis-column',
			value: target => <>
				<span title={DiskUtilsService.diskToStatusMessage(target.disks)}>{DiskUtilsService.diskToStatusMessage(target.disks)}</span>
				{!target.disks.isOutOfService && !target.disks.isPendingFormat && target.disks.status === consts.diskStatus.INITIALIZING &&
					<div className="status-progress">
						<span>{target.disks.nZeroedBlks ? Math.round(target.disks.nZeroedBlks * 100 / target.disks.blocks) : 0}%</span>
					</div>}
			</>
		},
		{
			name: 'Excluded',
			field: 'disks.isExcluded',
			className: 'fixed-size-column sx-column',
			type: 'boolean',
			rowClassName: 'fixed-size-column table-icon',
			value: target => target.disks.isExcluded && <>
				<i className="ion-checkmark-round checkmark"> </i>
				<i className="fa fa-info-circle blue" title={DiskUtilsService.getDiskHealthMessage(target.disks)}></i>
			</>
		},
		{
			name: 'Evicted',
			field: 'disks.isOutOfService',
			className: 'fixed-size-column sx-column',
			type: 'boolean',
			rowClassName: 'fixed-size-column table-icon',
			value: target => target.disks.isOutOfService && <>
				<i className="ion-checkmark-round checkmark"> </i>
				<i className="fa fa-info-circle blue" title={DiskUtilsService.getDiskHealthMessage(target.disks)}></i>
			</>
		},
		{
			name: 'Health',
			field: 'disks.health',
			className: 'fixed-size-column sx-column',
			filterable: false,
			rowClassName: 'fixed-size-column table-icon',
			value: target => <DriveHealthIcon drive={target.disks}/>
		}
	];

	const loadRows = async(filter, sort, currentPage, count) => {
		const drives = await DisksService.load(filter, sort, currentPage, count);

		drives.forEach(registerToEvents);

		return drives;
	};

	const registerToEvents = server => {
		const updateRow = (diskID, payload) => {
			tableRef.current?.updateRow(diskID, Object.assign(server.disks, payload));
		};

		SocketService.addHandler(SocketService.getDiskID(server.disks.diskID) + events.diskFailureEvent.name,
			({ payload }) => updateRow(server.disks.diskID, payload));

		SocketService.addHandler(SocketService.getDiskID(server.disks.diskID) + events.diskReappearEvent.name,
			({ payload }) => updateRow(server.disks.diskID, payload));

		SocketService.addHandler(SocketService.getDiskID(server.disks.diskID) + events.diskWentOnlineEvent.name,
			({ payload }) => updateRow(server.disks.diskID, payload));

		SocketService.addHandler(SocketService.getDiskID(server.disks.diskID) + events.diskEvictedEvent.name,
			({ payload }) => updateRow(server.disks.diskID, payload));

		SocketService.addHandler(SocketService.getDiskID(server.disks.diskID) + events.diskStatusChangeEvent.name,
			({ payload }) => updateRow(server.disks.diskID, payload));

		SocketService.addHandler(SocketService.getDiskID(server.disks.diskID) + events.DiskFinishedFormatEvent.name,
			({ payload }) => updateRow(server.disks.diskID, payload));

		SocketService.addHandler(SocketService.getDiskID(server.disks.uuid) + events.driveZeroingProgressChangeEvent.name,
			({ payload }) => updateRow(server.disks.diskID, payload));

		SocketService.addHandler(SocketService.getDiskID(server.disks.diskID) + events.newDiskEvent.name,
			({ payload }) => updateRow(server.disks.diskID, payload));

		SocketService.addHandler(SocketService.getDiskID(server.disks.diskID) + events.diskRemovedEvent.name, () => reloadTable());

		SocketService.addHandler(SocketService.getDiskID(server.disks.diskID) + events.formatDiskEvent.name,
			() => reloadTable());
	};

	const deleteDrives = async() => {
		const confirmed = await confirm(`Are you sure you want to delete ${selectedDrives.length} drive(s)?`);
		if (!confirmed) return;

		const disks = selectedDrives.map(drive => ({ _id: drive.disks.diskID, uuid: drive.disks.uuid }));
		const responses = await DisksService.deleteDisks(disks);
		const responsesBySuccess = extractResults(responses);

		if (responsesBySuccess.success.length) {
			successAlert(`${responsesBySuccess.success.length} Drive(s) deleted successfully`);
			reloadTable();
		}
		Object.keys(responsesBySuccess.failed).forEach(errorMsg => {
			errorAlert(`Failed to delete drives - ${errorMsg}`);
		});
	};

	const evictDrives = async() => {
		const confirmed = await confirm(`Are you sure you want to evict ${selectedDrives.length} drive(s)?`);
		if (!confirmed) return;

		const disks = selectedDrives.map(drive => ({ diskID: drive.disks.diskID, uuid: drive.disks.uuid }));

		const { allowEvict, shouldShowConfirm, msg } = await DiskUtilsService.validateEvictAction(disks);
		if (!allowEvict) {
			errorAlert(msg);
			return;
		}
		if (shouldShowConfirm) {
			const confirmed = await confirm(msg);
			if (!confirmed) return;
		}

		const responses = await DisksService.evictDisks(disks);
		const responsesBySuccess = extractResults(responses);

		if (responsesBySuccess.success.length) {
			successAlert(`${responsesBySuccess.success.length} Drive(s) evicted successfully`);
			reloadTable();
		}
		Object.keys(responsesBySuccess.failed).forEach(errorMsg => {
			errorAlert(`Failed to evict Drive - ${errorMsg}`);
		});
	};

	const formatDrives = async() => {
		const disks = selectedDrives.map(drive => ({ _id: drive.disks.diskID, uuid: drive.disks.uuid }));

		const confirmed = await confirm(`Warning: You are about to format ${disks.length} drive(s). Formatting will erase all the data on the drive(s).`, true);
		if (!confirmed) return;

		const responses = await DisksService.formatDisks(disks);
		const responsesBySuccess = extractResults(responses);

		if (responsesBySuccess.success.length) {
			successAlert(`Formatting command sent for ${responsesBySuccess.success.length} Drive(s)`);
			reloadTable();
		}
		Object.keys(responsesBySuccess.failed).forEach(errorMsg => {
			errorAlert(`Failed to format Drive - ${errorMsg}`);
		});
	};

	const createDriveClass = () => {
		const disks = selectedDrives.map(drive => ({
			diskID: drive.disks.diskID,
			node_id: drive.disks.nodeID,
			model: drive.disks.Model
		}));
		const driveClass = JSON.stringify({ disks });
		window.location.href = `/diskClasses?create=${driveClass}`;
	};

	return (
		<div className="page-content">
			<h1>Drives</h1>

			<div className="action-container">
				<button className="btn multi-select-action-btn btn-info mgmt-btn-info"
				        disabled={!currUser.isAdmin || !selectedDrives.length ||
					        selectedDrives.some(target => target.disks.isOutOfService || target.disks.isExcluded)}
				        onClick={() => evictDrives()}>
					Evict
				</button>
				<button className="btn multi-select-action-btn btn-info mgmt-btn-info"
				        disabled={!currUser.isAdmin || !selectedDrives.length ||
					        selectedDrives.some(target => !DiskUtilsService.isDriveDeletable(target, target.disks))}
				        onClick={deleteDrives}>
					Delete
				</button>
				<button className="btn multi-select-action-btn btn-info mgmt-btn-info"
				        disabled={!currUser.isAdmin || !selectedDrives.length ||
					        selectedDrives.some(target => !target.zone || target.disks.status === consts.diskStatus.FROZEN ||
						        target.disks.status === consts.diskStatus.FORMATTING || target.disks.isPendingFormat ||
						        target.disks.status === consts.diskStatus.MISSING || target.disks.isExcluded ||
						        DiskUtilsService.hasVolumeSegments(target.disks))}
				        onClick={() => formatDrives()}>
					Format
				</button>
				<div className="separator multi-select-action-btn"></div>

				<button className="btn multi-select-action-btn btn-info mgmt-btn-info"
				        disabled={!currUser.isAdmin || !selectedDrives.length || selectedDrives.some(
					        target => target.disks.isOutOfService || target.disks.isExcluded ||
						        [consts.diskStatus.NOT_INITIALIZED, consts.diskStatus.MISSING].includes(target.disks.status)
				        )}
				        onClick={() => createDriveClass()}>
					Create Drive class
				</button>
			</div>

			<FiltSortTable ref={tableRef}
			               tableId="drives"
			               columns={columns}
			               rowIdentifier="disks.diskID"
			               loadTotal={DisksService.loadTotal}
			               loadRows={loadRows}
			               multiselectOptions={{
				               enabled: true,
				               onSelectedRowsChange: setSelectedDrives
			               }}
			/>
		</div>
	);
};

export default Drives;

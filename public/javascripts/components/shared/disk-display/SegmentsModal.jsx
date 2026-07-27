/* global React, $, consts */

import FiltSortTable from '../../filtsort-table/FiltSortTable.jsx';
import Modal from '../../core/Modal.jsx';
import { DisksService } from '../../services/api/disks.service.js';
import { DiskUtilsService } from '../../services/disk-utils.service.js';

const { useState, useRef, useEffect } = React;

const DiskSegments = ({
	diskId,
	serverId,
	segmentsFilter
}) => {
	const tableRef = useRef();
	const [filter, setFilter] = useState(segmentsFilter);

	const columns = [
		{
			name: 'Target',
			field: 'disks.nodeID',
			filterable: false,
			className: 'fixed-size-column md-column',
			value: (row) => <a href={`/servers/server/${row.disks.nodeID}`}>{row.disks.nodeID}</a>,
		},
		{
			name: 'Volume',
			field: 'disks.diskSegments.volumeName',
			placeholder: 'Search by volume name',
			filterable: false,
			sortable: false,
			value: (row) => <a href={`/volumes?volume=${row.disks.diskSegments.volumeName}`}>{row.disks.diskSegments.volumeName}</a>,
		},
		{
			name: 'LBS',
			field: 'disks.diskSegments.lbs',
			className: 'fixed-size-column md-column',
			filterable: false,
			sort: 'asc',
			value: (row) => row.disks.diskSegments.lbs,
		},
		{
			name: 'LBE',
			field: 'disks.diskSegments.lbe',
			className: 'fixed-size-column md-column',
			filterable: false,
			value: (row) => row.disks.diskSegments.lbe,
		},
		{
			name: 'Size',
			field: 'disks.diskSegments.size',
			className: 'fixed-size-column md-column',
			filterable: false,
			sortable: false,
			value: (row) => (row.disks.diskSegments.lbe - row.disks.diskSegments.lbs) * 4096,
		},
		{
			name: 'Status',
			field: 'disks.diskSegments.status',
			className: 'fixed-size-column sm-column',
			value: (row) => (
				<label className="label" style={{ backgroundColor: DiskUtilsService.getSegmentColor(row.disks.diskSegments) }}>
					{row.disks.diskSegments.status}
				</label>),
		},
		{
			name: 'UUID',
			field: 'disks.diskSegments.uuid',
			className: 'fixed-size-column xl-column',
			value: (row) => row.disks.diskSegments.uuid,
		},
	];

	const reloadTable = () => {
		if (tableRef.current) {
			tableRef.current.reloadRows();
			tableRef.current.reloadTotal();
		}
	};

	useEffect(() => {
		reloadTable();
	}, [filter]);

	const loadRows = async(tableFilter, sort, currentPage, count) => {
		const requestFilter = JSON.stringify({ ...filter, ...tableFilter, 'disks.diskSegments.type': { $ne: consts.segmentTypes.EXCELERO_METADATA } });
		const requestSort = JSON.stringify(sort);

		const data = await DisksService.loadDiskSegments(diskId, serverId, requestFilter, requestSort, currentPage, count, { disableParamsAsJSON: true });
		return data.edges;
	};

	const loadTotal = async(tableFilter) => {
		const requestFilter = JSON.stringify({ ...filter, ...tableFilter, 'disks.diskSegments.type': { $ne: consts.segmentTypes.EXCELERO_METADATA } });

		// todo: we should create API for fetching disk segments count
		const data = await DisksService.loadDiskSegments(diskId, serverId, requestFilter, {}, 0, 1, { disableParamsAsJSON: true });
		return data.pageInfo[0]?.count || 0;
	};

	return (
		<div className="modal-body">

			<button className="btn btn-info btn-sm"
			        onClick={() => setFilter({})}
			        disabled={$.isEmptyObject(filter)}>
				<i className="fa fa-eye"></i> Show all segments on drive
			</button>

			<FiltSortTable tableID="disk-segments-table"
			               ref={tableRef}
			               columns={columns}
			               loadRows={loadRows}
			               loadTotal={loadTotal}
			/>

		</div>
	);
};

const SegmentsModal = ({
	isOpen,
	handleCancel = () => {},
	diskId,
	serverId,
	segmentsFilter
}) => {
	return (
		<Modal
			isOpen={isOpen}
			onClose={() => handleCancel()}
			className="modal-xl"
			disableBackdropClose
			attachToRoot
			title={`Drive Segments - ${diskId}`}>
			<DiskSegments
				diskId={diskId}
				serverId={serverId}
				segmentsFilter={segmentsFilter}
			/>
		</Modal>
	);
};

export default SegmentsModal;
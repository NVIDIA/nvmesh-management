/* global React */

import FiltSortTable from '../filtsort-table/FiltSortTable.jsx';
import { LogsService } from '../services/api/logs.service.js';
import TextWithDynamicLinks from '../shared/TextWithDynamicLinks.jsx';
import { SocketService, events } from '../services/socket.service.js';
import ManagementID from '../shared/ManagementID.jsx';
import { throttledFetch } from '../utils.js';
import { useAlerts } from '../core/Alert.jsx';

const { useRef, useEffect } = React;

export const levelToClass = {
	INFO: 'info',
	WARNING: 'warning',
	ERROR: 'danger',
	DEBUG: 'default'
};

const Logs = () => {
	const tableRef = useRef();
	const { infoAlert } = useAlerts();

	const columns = [
		{
			name: 'Header',
			field: 'meta.header',
			placeholder: 'Search by Header',
			className: 'fixed-size-column lg-column',
			value: row => <strong>{row.meta.header}</strong>
		},
		{
			name: 'Message',
			field: 'message',
			placeholder: 'Search by Message',
			className: 'fixed-size-column lg-column',
			rowClassName: 'wrap',
			value: row => row.meta.rawMessage ? <TextWithDynamicLinks links={row.meta.links} textTemplate={row.meta.rawMessage}/> : row.message
		},
		{
			name: 'Date Created',
			field: 'timestamp',
			placeholder: 'Search by Date Created',
			type: 'dateRange',
			className: 'fixed-size-column md-column',
			rowClassName: 'fixed-size-column',
			sort: 'desc'
		},
		{
			name: 'Management ID',
			field: 'meta.managementID',
			placeholder: 'Search by Management ID',
			className: 'fixed-size-column lg-column',
			rowClassName: 'fixed-size-column',
			value: (row) => <ManagementID id={row.meta.managementID}/>,
		},
		{
			name: 'Date Modified',
			field: 'meta.dateModified',
			placeholder: 'Search by Date Modified',
			type: 'dateRange',
			className: 'fixed-size-column md-column',
			rowClassName: 'fixed-size-column'
		},
		{
			name: 'Audit',
			field: 'meta.isAudit',
			placeholder: 'Search by Audit',
			type: 'boolean',
			className: 'fixed-size-column sx-column',
			rowClassName: 'fixed-size-column'
		},
		{
			name: 'Security',
			field: 'meta.isSecurity',
			placeholder: 'Search by Audit',
			type: 'boolean',
			className: 'fixed-size-column sx-column',
			rowClassName: 'fixed-size-column'
		},
		{
			name: 'Acknowledged',
			field: 'meta.acknowledged',
			type: 'boolean',
			className: 'fixed-size-column md-column',
			rowClassName: 'fixed-size-column'
		},
		{
			name: 'Acknowledged By',
			field: 'meta.acknowledgedBy',
			placeholder: 'Search by Acknowledged By',
			className: 'fixed-size-column md-column'
		},
		{
			name: 'Level',
			field: 'level',
			placeholder: 'Search by Level',
			type: 'choice',
			choices: ['DEBUG', 'INFO', 'WARNING', 'ERROR'],
			className: 'fixed-size-column sx-column',
			value: row => <span className={'log-level label label-' + levelToClass[row.level]}> {row.level}</span>
		}
	];

	const reloadTable = throttledFetch(() => {
		if (tableRef.current) {
			tableRef.current.reloadRows();
			tableRef.current.reloadTotal();
		}
	}, 2000);

	useEffect(() => {
		SocketService.addHandler(events.newLogEvent.name, () => {
			reloadTable();
		});
		SocketService.addHandler(events.allLogsAcknowledgedEvent.name, ({ payload }) => {
			infoAlert(`All ${payload.count} logs acknowledged`);
			reloadTable();
		});
	}, []);

	const loadRows = async(filter, sort, currentPage, count) => {
		const logs = await LogsService.loadLogs(filter, sort, currentPage, count);
		logs.forEach(log => {
			const logEventName = SocketService.getLogID(log._id) + events.logChangedEvent.name;
			SocketService.addHandler(logEventName, ({ payload }) => {
				if (tableRef.current) {
					tableRef.current.updateRow(payload._id, Object.assign(log, payload));
				}
			});
		});

		return logs;
	};

	return (
		<div className="page-content">
			<h1>Logs</h1>

			<FiltSortTable ref={tableRef}
			               tableId="logs"
			               columns={columns}
			               loadTotal={LogsService.loadTotal}
			               loadRows={loadRows}
			/>
		</div>
	);
};

export default Logs;
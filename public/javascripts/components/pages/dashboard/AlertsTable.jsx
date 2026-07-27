/* global React */

import FiltSortTable from '../../filtsort-table/FiltSortTable.jsx';
import { LogsService } from '../../services/api/logs.service.js';
import { useAppContext } from '../App.jsx';
import { levelToClass } from '../Logs.jsx';
import TextWithDynamicLinks from '../../shared/TextWithDynamicLinks.jsx';
import { useAlerts } from '../../core/Alert.jsx';
import { useConfirmationDialog } from '../../shared/ConfirmationDialog.jsx';
import { extractErrorMsg } from '../../utils.js';
import { SocketService, events } from '../../services/socket.service.js';

const { useRef, useEffect } = React;

const AlertsTable = () => {
	const { currUser } = useAppContext();
	const { errorAlert, infoAlert } = useAlerts();
	const [confirm] = useConfirmationDialog();
	const tableRef = useRef();

	const columns = [
		{
			name: 'Header',
			field: 'meta.header',
			value: (row) => <strong>{row.meta.header}</strong>,
		},
		{
			name: 'Message',
			field: 'message',
			value: row => row.meta.rawMessage ? <TextWithDynamicLinks links={row.meta.links} textTemplate={row.meta.rawMessage}/> : row.message
		},
		{
			name: 'Date Created',
			field: 'timestamp',
			type: 'dateRange',
			sort: 'desc',
			className: 'fixed-size-column md-column',
		},
		{
			name: 'Level',
			field: 'level',
			type: 'choice',
			choices: ['WARNING', 'ERROR'],
			className: 'fixed-size-column sx-column',
			rowClassName: 'fixed-size-column',
			value: (row) => <span className={`log-level label label-${levelToClass[row.level]}`}>{row.level}</span>,
		},
		{
			name: 'Acknowledge',
			field: 'acknowledge',
			className: 'fixed-size-column sx-column',
			rowClassName: 'fixed-size-column',
			filterable: false,
			sortable: false,
			value: (row) =>
				<button className="btn btn-info light-blue" disabled={!currUser.isAdmin} onClick={() => ackAlert(row._id)}>Ack</button>
		}
	];

	const reloadTable = () => {
		if (tableRef.current) {
			tableRef.current.reloadRows();
			tableRef.current.reloadTotal();
		}
	};

	useEffect(() => {
		SocketService.addHandler(events.allLogsAcknowledgedEvent.name, ({ payload }) => {
			infoAlert(`All ${payload.count} logs acknowledged`);
			reloadTable();
		});
	}, []);

	const ackAlert = async(alertId) => {
		const res = await LogsService.acknowledge(alertId);
		if (!res.success) {
			const errorMsg = extractErrorMsg(res.error);
			errorAlert(`Failed to acknowledge alert ${alertId} - ${errorMsg}`);
		} else {
			reloadTable();
		}
	};

	const ackAllAlerts = async() => {
		const confirmed = await confirm('Are you sure you want to acknowledge all alerts? Warning: This operation is irreversible');
		if (!confirmed) {
			return;
		}

		const res = await LogsService.acknowledgeAll();
		if (!res.success) {
			const errorMsg = extractErrorMsg(res.error);
			errorAlert(`Failed to acknowledge all alerts - ${errorMsg}`);
		} else {
			reloadTable();
		}
	};

	return (
		<>
			<button className="btn btn-info light-blue" onClick={ackAllAlerts}>Ack All</button>
			<FiltSortTable ref={tableRef}
			               tableId="alerts"
			               columns={columns}
			               queryParamsEnabled={false}
			               loadTotal={LogsService.loadAlertsCount}
			               loadRows={LogsService.loadAlerts}
			/>
		</>
	);
};

export default AlertsTable;
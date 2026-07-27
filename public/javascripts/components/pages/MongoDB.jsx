/* global React, consts */

import { MongoDBService } from '../services/api/mongoDB.service.js';
import FiltSortTable from '../filtsort-table/FiltSortTable.jsx';
import CapacityService from '../services/capacity.service.js';
import { useAppContext } from './App.jsx';

const {
	useState,
	useEffect
} = React;

const getStateCaption = (member) => {
	switch (member.state) {
		case consts.mongoMemberState.STARTUP:
			return 'STARTUP';
		case consts.mongoMemberState.PRIMARY:
			return 'PRIMARY';
		case consts.mongoMemberState.SECONDARY:
			return 'SECONDARY';
		case consts.mongoMemberState.RECOVERING:
			return 'RECOVERING';
		case consts.mongoMemberState.STARTUP2:
			return 'STARTUP2';
		case consts.mongoMemberState.UNKNOWN:
			return 'UNKNOWN';
		case consts.mongoMemberState.ARBITER:
			return 'ARBITER';
		case consts.mongoMemberState.DOWN:
			return 'DOWN';
		case consts.mongoMemberState.ROLLBACK:
			return 'ROLLBACK';
		case consts.mongoMemberState.REMOVED:
			return 'REMOVED';
		case 'STAND ALONE':
			return 'STANDALONE';
		default:
			return member.stateStr;
	}
};

const getStateTitle = (state) => {
	switch (state) {
		case consts.mongoMemberState.STARTUP:
			return 'Not yet an active member of any set.';
		case consts.mongoMemberState.PRIMARY:
			return 'The member in state PRIMARY is the only member that can accept write operations. Eligible to vote.';
		case consts.mongoMemberState.SECONDARY:
			return 'A member in state SECONDARY is replicating the data store. Eligible to vote.';
		case consts.mongoMemberState.RECOVERING:
			return 'Data is not available for reads from this member. Eligible to vote.';
		case consts.mongoMemberState.STARTUP2:
			return 'The member has joined the set and is running an initial sync. Eligible to vote.';
		case consts.mongoMemberState.UNKNOWN:
			return 'The member’s state, as seen from another member of the set, is not yet known.';
		case consts.mongoMemberState.ARBITER:
			return 'Arbiters do not replicate data and exist solely to participate in elections. Eligible to vote.';
		case consts.mongoMemberState.DOWN:
			return 'The member, as seen from another member of the set, is unreachable.';
		case consts.mongoMemberState.ROLLBACK:
			return 'This member is actively performing a rollback. Eligible to vote. Data is not available for reads from this member.';
		case consts.mongoMemberState.REMOVED:
			return 'This member was once in a replica set but was subsequently removed.';
		default:
			return '';
	}
};

const getHealthIcon = (health) => {
	switch (health) {
		case consts.mongoMemberHealth.HEALTHY:
			return <i className="ion-checkmark-circled green table-icon"></i>;
		case consts.mongoMemberHealth.CRITICAL:
			return <i className="fa fa-exclamation-circle red table-icon"></i>;
		default:
			return null;
	}
};

const MongoDB = () => {
	const [mongoDB, setMongoDB] = useState({});
	const [isLoaded, setIsLoaded] = useState(false);
	const { unitType } = useAppContext();

	useEffect(() => {
		const fetchData = async() => {
			const data = await MongoDBService.loadAll();
			setMongoDB(data[0]);
			setIsLoaded(true);
		};

		fetchData();
	}, []);

	const columns = [
		{
			name: 'Host',
			field: 'host',
			filterable: false,
			sortable: false,
			className: 'fixed-size-column lg-column',
			value: row => <strong>{row.host}</strong>,
		},
		{
			name: 'Port',
			field: 'port',
			filterable: false,
			sortable: false,
			className: 'fixed-size-column sx-column',
		},
		{
			name: 'State',
			field: 'stateStr',
			filterable: false,
			sortable: false,
			value: row => <span title={getStateTitle(row.state)}>{getStateCaption(row)}</span>,
		},
		{
			name: 'Database Size',
			field: 'dbSize',
			filterable: false,
			sortable: false,
			value: row =>
				<span title="The total size of the uncompressed data held in the database.">
					{CapacityService.toBiggestUnit(row.dbSize, unitType, { fromBytes: true })}
				</span>,
		},
		{
			name: 'Free Space',
			field: 'freeSpace',
			filterable: false,
			sortable: false,
			value: row =>
				<span title="The total size of free drive space on the filesystem where MongoDB stores data.">
					{CapacityService.toBiggestUnit(row.freeSpace, unitType, { fromBytes: true })}
				</span>,
		},
		{
			name: 'Last Heartbeat',
			field: 'lastHeartbeat',
			filterable: false,
			sortable: false,
			type: 'dateRange',
		},
		{
			name: 'Last Heartbeat Received',
			field: 'lastHeartbeatRecv',
			filterable: false,
			sortable: false,
			type: 'dateRange',
		},
		{
			name: 'Last Heartbeat Message',
			field: 'lastHeartbeatMessage',
			filterable: false,
			sortable: false,
		},
		{
			name: 'Health',
			field: 'health',
			filterable: false,
			sortable: false,
			className: 'fixed-size-column sx-column',
			rowClassName: 'fixed-size-column',
			value: row => getHealthIcon(row.health),
		},
	];

	return (
		<div className="page-content">
			<h1>MongoDB</h1>

			{isLoaded && mongoDB.set && <h2>Replica Set: {mongoDB.set}</h2>}
			{isLoaded && (
				<FiltSortTable
					tableId="mongoDB"
					columns={columns}
					loadTotal={() => mongoDB.members?.length || 0}
					loadRows={() => mongoDB.members || []}
					paginationDisabled={true}
				/>
			)}
		</div>
	);
};

export default MongoDB;

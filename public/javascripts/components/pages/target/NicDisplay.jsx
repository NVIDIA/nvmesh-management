/* global React, consts */

import { AppContext } from '../../App.jsx';

const { useContext } = React;

const guidToIP = (nic) => {
	if (nic.protocol !== consts.nicProtocol.IB) {
		if (nic.guid.substring(0, 26) === '0x00000000000000000000ffff') {
			const ipPortion = nic.guid.substring(nic.guid.length - 8);
			return [
				parseInt(ipPortion.substr(0, 2), 16),
				parseInt(ipPortion.substr(2, 2), 16),
				parseInt(ipPortion.substr(4, 2), 16),
				parseInt(ipPortion.substr(6, 2), 16)
			].join('.');
		} else {
			const subnet = [], addr = [];
			let found = false;
			let i;
			let x;
			for (i = 14; i >= 2; i -= 4) {
				x = nic.guid.substr(i, 4);

				if (x !== '0000' || found) {
					found = true;
					x = parseInt(x, 16).toString(16);
					subnet.unshift(x);
				}
			}
			found = false;
			for (i = 18; i <= 30; i += 4) {
				x = nic.guid.substr(i, 4);

				if (x !== '0000' || found) {
					found = true;
					x = parseInt(x, 16).toString(16);
					addr.push(x);
				}
			}
			return '[' + subnet.join(':') + '::' + addr.join(':') + ']';
		}
	}
};

const nicToHealth = (nic) => {
	return nic.status === consts.nicStatus.OK ? '' : 'fa fa-exclamation-circle red';
};

const nicToHealthMessage = (nic) => {
	const statusMessages = {
		[consts.nicStatus.LINK_DOWN]: 'Link is down',
		[consts.nicStatus.MISSING]: 'NIC is missing',
		[consts.nicStatus.ERROR]: 'NIC reported error'
	};

	return nic.status === consts.nicStatus.OK ? '' : statusMessages[nic.status] || nic.status;
};

const getNicProtocols = (nic) => {
	return (nic.protocol !== consts.nicProtocol.MULTI) ? [nic.protocol] : [consts.nicProtocol.ROCE, consts.nicProtocol.TCP];
};


const NicDisplay = ({
	nic,
	onDelete = () => {}
}) => {
	const { currUser } = useContext(AppContext);

	return (
		<div className="nic">
			<div className="nic-display" title={nic.pkey ? `pkey: ${nic.pkey}` : ''}>
				<div className="header">
					<h4 className="box-header with-border">{guidToIP(nic)}</h4>
				</div>
				<div className="body">
					<div>ID <small>{nic.nicID}</small></div>
					<div>
						<strong>Protocol </strong>
						{getNicProtocols(nic).map((protocol, index) => (
							<span key={index} className="label label-info nic-protocol">{protocol}</span>
						))}
					</div>
					<div>MTU <span className={`label ${nic.mtu <= consts.NIC_MTU_THRESHOLD ? 'label-success' : 'label-warning'}`}>{nic.mtu}</span></div>
					<div>Device <small>{nic.deviceType}</small></div>
					<div style={{ display: 'none' }}>Speed <small>{nic.speed}</small></div>
					<div>PCI Root <small>{nic.pci_root}</small></div>

					<button className="btn btn-danger mgmt-btn-danger"
					        disabled={!currUser.isAdmin || nic.status !== consts.nicStatus.MISSING}
					        onClick={() => onDelete(guidToIP(nic), nic)}>Del
					</button>

					<i className="nic-icon fa fa-signal"></i>
					<i className={`nic-status ${nicToHealth(nic)}`} title={nicToHealthMessage(nic)}></i>
				</div>
			</div>
		</div>
	);
};

export default NicDisplay;

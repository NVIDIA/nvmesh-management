/* global React */

import ClusterIDModal from './shared/ClusterIDModal.jsx';
import CustomerNameModal from './shared/CustomerNameModal.jsx';
import ManagementService from './services/api/management.service.js';
import { extractErrorMsg } from './utils.js';
import { useAlerts } from './core/Alert.jsx';

const { useState, useEffect } = React;

const PageContent = ({ children }) => {
	const [showClusterIDModal, setShowClusterIDModal] = useState(false);
	const [showCustomerNameModal, setShowCustomerNameModal] = useState(false);
	const { successAlert, errorAlert } = useAlerts();

	useEffect(() => {
		const fetchClusterID = async() => {
			const clusterID = await ManagementService.getClusterInfo();
			if (!clusterID?.id) {
				setShowClusterIDModal(true);
			}
		};
		fetchClusterID();
	}, []);

	const updateClusterID = async(clusterID) => {
		const res = await ManagementService.updateClusterID(clusterID);
		if (res.success) {
			successAlert('Cluster ID Saved');
		} else {
			const errorMsg = extractErrorMsg(res.error);
			errorAlert(`Failed to save Cluster ID - ${errorMsg}`);
		}
		setShowClusterIDModal(false);
	};

	// eslint-disable-next-line no-unused-vars
	const saveCustomerName = async(customerName) => {

	};

	return (
		<>
			<ClusterIDModal
				isOpen={showClusterIDModal}
				handleCancel={() => setShowClusterIDModal(false)}
				onSubmit={clusterID => updateClusterID(clusterID)}
			/>

			<CustomerNameModal
				isOpen={showCustomerNameModal}
				handleCancel={() => setShowCustomerNameModal(false)}
				onSubmit={customerName => saveCustomerName(customerName)}
			/>

			{children}
		</>
	);
};

export default PageContent;
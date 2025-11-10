/* global React, consts */

import ClusterIDModal from './shared/ClusterIDModal.jsx';
import CustomerNameModal from './shared/CustomerNameModal.jsx';
import { extractErrorMsg } from './utils.js';
import { useAlerts } from './core/Alert.jsx';
import { useAppContext } from './App.jsx';
import { UsersService } from './services/api/users.service.js';
import { NvmeshMetadataService } from './services/api/nvmesh-metadata.service.js';

const { useState, useEffect } = React;

const PageContent = ({ children }) => {
	const { systemInfo, loadSystemInfo } = useAppContext();
	const [showClusterIDModal, setShowClusterIDModal] = useState(false);
	const [showCustomerNameModal, setShowCustomerNameModal] = useState(false);
	const [phoneHomeUser, setPhoneHomeUser] = useState(null);
	const { successAlert, errorAlert } = useAlerts();

	useEffect(() => {
		if (!systemInfo.clusterID) {
			setShowClusterIDModal(true);
		}

		const fetchPhoneHomeUser = async() => {
			const phoneHomeUser = await UsersService.getPhoneHomeUser();
			if (phoneHomeUser.email === consts.defaultExceleroEmail) {
				setShowCustomerNameModal(true);
				setPhoneHomeUser(phoneHomeUser);
			}
		};

		fetchPhoneHomeUser();
	}, []);

	const updateClusterID = async(clusterID) => {
		const res = await NvmeshMetadataService.updateClusterID(clusterID);

		if (res.success) {
			successAlert('Cluster ID Saved');
			loadSystemInfo();
		} else {
			const errorMsg = extractErrorMsg(res.error);
			errorAlert(`Failed to save Cluster ID - ${errorMsg}`);
		}
		setShowClusterIDModal(false);
	};

	const saveCustomerName = async(customerName) => {
		const email = consts.defaultExceleroEmail.replace(RegExp('\\+.*@'), '+' + customerName + '@');
		const results = await UsersService.updateUsers([{ ...phoneHomeUser, email }]);

		if (results[0].success) {
			successAlert('Customer Name Saved');
		} else {
			const errorMsg = extractErrorMsg(results[0].error);
			errorAlert(`Failed to save Customer Name - ${errorMsg}`);
		}
		setShowCustomerNameModal(false);
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
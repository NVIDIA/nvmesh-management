/* global React */

import TopNavbar from './TopNavbar.jsx';
import Sidebar from './Sidebar.jsx';
import Modal from '../core/Modal.jsx';
import ClusterIDModal from './ClusterIDModal.jsx';
import CustomerNameModal from './CustomerNameModal.jsx';
import { ManagementService } from '../services/api/management.service.js';
import { useAlerts } from '../core/Alert.jsx';
import { extractErrorMsg } from '../utils.js';
import PageProgressBar from '../core/PageProgressBar.jsx';

const { useState, useEffect, useRef } = React;

const IS_ALIVE_INTERVAL = 5000; // 5 seconds
const IS_ALIVE_MAX_FAILURES = 3;

const AppShell = ({ children }) => {
	const { successAlert, errorAlert } = useAlerts();
	const [isSidebarOpen, setIsSidebarOpen] = useState(false);
	const [showConnectionModal, setShowConnectionModal] = useState(false);
	const [showClusterIDModal, setShowClusterIDModal] = useState(false);
	const [showCustomerNameModal, setShowCustomerNameModal] = useState(false);
	
	const failureCounterRef = useRef(0);
	const timeoutRef = useRef(null);
	const abortControllerRef = useRef(null);

	const checkIfAlive = async() => {
		// Cancel previous request if still pending
		if (abortControllerRef.current) {
			abortControllerRef.current.abort();
		}

		// Create new abort controller for this request
		abortControllerRef.current = new AbortController();

		try {
			const response = await fetch('/isAlive', { credentials: 'same-origin', redirect: 'follow' });
			if (response.redirected) {
				window.location.href = response.url;
				return;
			}

			if (response.error?.message?.indexOf('/login') > -1) {
				// save the current URL to redirect back here after login
				const currentUrl = encodeURIComponent(location.pathname + location.search);
				return location.href = '/login?redirectTo=' + currentUrl;
			}

			failureCounterRef.current = 0;
			setShowConnectionModal(false);
		} catch (error) {
			if (error.name === 'AbortError') {
				return;
			}
			failureCounterRef.current++;

			if (failureCounterRef.current >= IS_ALIVE_MAX_FAILURES) {
				setShowConnectionModal(true);
			}
		}

	};

	const scheduleNextCheck = () => {
		timeoutRef.current = setTimeout(() => {
			checkIfAlive().finally(() => {
				scheduleNextCheck();
			});
		}, IS_ALIVE_INTERVAL);
	};

	useEffect(() => {
		const fetchClusterID = async() => {
			const clusterID = await ManagementService.getClusterInfo();
			if (!clusterID?.id) {
				setShowClusterIDModal(true);
			}
		};
		fetchClusterID();
	}, []);

	useEffect(() => {
		// Start the periodic checking
		checkIfAlive().finally(() => {
			scheduleNextCheck();
		});

		// Cleanup on unmount
		return () => {
			if (timeoutRef.current) {
				clearTimeout(timeoutRef.current);
			}
			if (abortControllerRef.current) {
				abortControllerRef.current.abort();
			}
		};
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
			<PageProgressBar/>
			<div className={`${isSidebarOpen ? 'sidebar-collapse' : ''}`}>
				<div className="wrapper">
					<TopNavbar onToggleSidebar={() => setIsSidebarOpen(!isSidebarOpen)}/>
					<Sidebar/>
				</div>
			</div>

			{children}

			{/* No Connection Modal */}
			<Modal
				isOpen={showConnectionModal}
				title="Lost connection to server"
				disableBackdropClose
				centerVertically
				attachToRoot
				noCloseButton
				className="vertical-align-center"
			>
				<div className="modal-body">
					<p style={{ padding: '20px 0' }}>Could not connect to Management Server</p>
				</div>
			</Modal>

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
		</>
	);
};

export default AppShell;
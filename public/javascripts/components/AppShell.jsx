/* global React */

import TopNavbar from './shared/TopNavbar.jsx';
import Sidebar from './shared/Sidebar.jsx';
import Modal from './core/Modal.jsx';
import PageProgressBar from './core/PageProgressBar.jsx';
import Router from './Router.jsx';
import { AlertsProvider } from './core/Alert.jsx';
import PageContent from './PageContent.jsx';

const { useState, useEffect, useRef } = React;

const IS_ALIVE_INTERVAL = 5000; // 5 seconds
const IS_ALIVE_MAX_FAILURES = 3;

const AppShell = () => {
	const [isSidebarOpen, setIsSidebarOpen] = useState(false);
	const [showConnectionModal, setShowConnectionModal] = useState(false);
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

	return (
		<>
			<PageProgressBar/>

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

			<div className={`wrapper ${isSidebarOpen ? 'sidebar-collapse' : ''}`}>
				<TopNavbar onToggleSidebar={() => setIsSidebarOpen(!isSidebarOpen)}/>
				<Sidebar/>

				<div className="content-wrapper">
					<section className="content">
						<AlertsProvider>
							<PageContent>
								<Router/>
							</PageContent>
						</AlertsProvider>
					</section>
				</div>
			</div>
		</>
	);
};

export default AppShell;
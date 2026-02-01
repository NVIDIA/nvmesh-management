/* global React, ReactDOM */

import Transition from './Transition.jsx';

const {
	useEffect,
	createContext,
	useState,
	useContext
} = React;

const statusToClass = {
	info: 'info',
	success: 'success',
	warning: 'warning',
	error: 'danger'
};

const statusToIcon = {
	success: 'ion ion-checkmark-round',
	error: 'ion ion-alert-circled',
	info: 'ion ion-information-circled'
};

const statusToTitle = {
	success: 'Success',
	warning: 'Warning',
	error: 'Failed'
};

const Alert = ({
	status,
	message = '',
	body = null,
	timeout = 6000,
	onDismiss = () => {},
}) => {
	const [visible, setVisible] = useState(true);

	useEffect(() => {
		if (timeout > 0) {
			const timer = setTimeout(() => setVisible(false), timeout);
			return () => clearTimeout(timer);
		}
	}, []);

	const dismissAlert = (e) => {
		e.preventDefault();
		setVisible(false);
	};

	return (
		<Transition className="fade slide" on={visible} onExited={() => onDismiss()}>
			<div className={`alert alert-${statusToClass[status]} fading-alert`}>
				<a href="#" className="close" aria-label="close" onClick={dismissAlert}>
					&times;
				</a>
				<i className={`${statusToIcon[status]}`}></i>
				{statusToTitle[status] && <strong>{statusToTitle[status]}!</strong>}
				<span>{message}</span>
				{body && <small>{body}</small>}
			</div>
		</Transition>
	);
};

const AlertsContainer = ({ children }) => {
	return (
		<div className="fading-alerts-container">
			{children}
		</div>
	);
};

const AlertsContext = createContext();

function generateUniqueId() {
	return `${new Date().getTime()}-${Math.random().toString(36).substring(2, 9)}`;
}

const AlertRef = {
	instance: null,

	createInstance() {
		return {};
	},

	getInstance() {
		if (!AlertRef.instance) {
			AlertRef.instance = AlertRef.createInstance();
		}
		return AlertRef.instance;
	}
};

const AlertsProvider = ({ children }) => {
	const [alerts, setAlerts] = useState([]);

	useEffect(() => {
		const alertsRefInstance = AlertRef.getInstance();
		alertsRefInstance.successAlert = (message, options = {}) => {
			createAlert({
				timeout: 6000,
				...options,
				message,
				status: 'success',
			});
		};

		alertsRefInstance.errorAlert = (message, options = {}) => {
			createAlert({
				timeout: 11000,
				...options,
				message,
				status: 'error',
			});
		};
	}, []);

	const createAlert = (alert) => {
		const id = generateUniqueId();
		setAlerts((prev) => [{ ...alert, id: id }, ...prev]);
		return id;
	};

	const removeAlert = (id) => {
		setAlerts((prev) => prev.filter((alert) => alert.id !== id));
	};

	const removeAllAlerts = () => {
		setAlerts([]);
	};

	const onAlertDismiss = (alert) => {
		removeAlert(alert.id);
		if (alert.onDismiss) {
			alert.onDismiss();
		}
	};

	const rootAlerts = alerts.filter((alert) => alert.attachToRoot);
	const nonRootAlerts = alerts.filter((alert) => !alert.attachToRoot);

	return (
		<AlertsContext.Provider value={{
			removeAllAlerts,
			createAlert,
			removeAlert
		}}>
			{/* change to RootAlertsProvider once all app shell is implemented in React */}
			{ReactDOM.createPortal(rootAlerts.map(alert =>
				<Alert key={alert.id} {...alert} onDismiss={() => onAlertDismiss(alert)} />
			), document.getElementById('fading-alerts-root'))}

			<AlertsContainer>
				{nonRootAlerts.map(alert => <Alert key={alert.id} {...alert} onDismiss={() => onAlertDismiss(alert)}/>)}
			</AlertsContainer>
			{children}
		</AlertsContext.Provider>
	);
};

const useAlerts = () => {
	const { createAlert, removeAlert, removeAllAlerts } = useContext(AlertsContext);

	const infoAlert = (message, options = {}) => {
		addAlert({
			timeout: 6000,
			...options,
			message,
			status: 'info',
		});
	};

	const successAlert = (message, options = {}) => {
		addAlert({
			timeout: 6000,
			...options,
			message,
			status: 'success',
		});
	};

	const errorAlert = (message, options = {}) => {
		addAlert({
			timeout: 11000,
			...options,
			message,
			status: 'error',
		});
	};

	const addAlert = (alert) => {
		return createAlert(alert);
	};

	const clearAlerts = () => {
		removeAllAlerts();
	};

	const clearAlert = (id) => {
		removeAlert(id);
	};

	return {
		addAlert,
		clearAlert,
		successAlert,
		errorAlert,
		clearAlerts,
		infoAlert
	};
};

export { AlertRef, Alert, AlertsContainer, AlertsProvider, AlertsContext, useAlerts };
/*
 * SPDX-FileCopyrightText: Copyright (c) 2026 NVIDIA CORPORATION & AFFILIATES. All rights reserved.
 * SPDX-License-Identifier: Apache-2.0
 */

/* global React, user, consts */

import { ConfirmationDialogsProvider } from './shared/ConfirmationDialog.jsx';
import { extractErrorMsg } from './utils.js';
import { GeneralSettingsService } from './services/api/general-settings.service.js';
import { UsersService } from './services/api/users.service.js';
import ManagementService from './services/api/management.service.js';
import AppShell from './AppShell.jsx';

const { createContext, useContext, useState, useEffect } = React;

export const AppContext = createContext(null);
export const useAppContext = () => useContext(AppContext);

export const AppContextProvider = ({ children }) => {
	const [generalSettings, setGeneralSettings] = useState(null);
	const [defaultDomain, setDefaultDomain] = useState(null);
	const [currUser, setCurrUser] = useState(user);
	const [userUnitType, setUserUnitType] = useState(null);
	const [systemInfo, setSystemInfo] = useState(null);

	const loadGeneralSettings = async() => {
		const response = await GeneralSettingsService.load();
		if (response.success) {
			setGeneralSettings(response.results);
			loadUnitType(response.results.defaultUnitType);
		} else {
			const errorMsg = extractErrorMsg(response.error);
			console.error(`Failed to load general settings - ${errorMsg}`);
		}
	};

	const loadDefaultDomain = async() => {
		const response = await UsersService.getDefaultDomain();
		setDefaultDomain(response);
	};

	const loadUnitType = (defaultUnitType) => {
		const storageUnitType = localStorage.getItem('unitType');

		if (storageUnitType && storageUnitType !== 'default') {
			setUserUnitType(storageUnitType);
		} else {
			setUserUnitType(defaultUnitType || consts.unitType.DECIMAL);
		}
	};

	const setUnitType = (unitType) => {
		localStorage.setItem('unitType', unitType);
		loadUnitType(generalSettings?.defaultUnitType);
	};

	const loadSystemInfo = async() => {
		const sysInfo = await ManagementService.getSystemInfo();
		setSystemInfo(sysInfo);
	};

	useEffect(() => {
		const fetchData = async() => {
			loadGeneralSettings();
			loadDefaultDomain();
			await loadSystemInfo();
		};
		fetchData();
	}, []);

	const requiredDataLoaded = generalSettings && systemInfo;

	return requiredDataLoaded && (
		<AppContext.Provider value={{
			generalSettings,
			loadGeneralSettings,
			defaultDomain,
			loadDefaultDomain,
			loadSystemInfo,
			currUser,
			setCurrUser,
			unitType: userUnitType,
			setUnitType: setUnitType,
			systemInfo
		}}>
			{children}
		</AppContext.Provider>
	);
};

const App = () => {

	return (
		<AppContextProvider>
			<ConfirmationDialogsProvider>
				<AppShell />
			</ConfirmationDialogsProvider>
		</AppContextProvider>
	);
};
export default App;

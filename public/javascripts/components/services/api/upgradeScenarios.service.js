/*
 * SPDX-FileCopyrightText: Copyright (c) 2026 NVIDIA CORPORATION & AFFILIATES. All rights reserved.
 * SPDX-License-Identifier: Apache-2.0
 */

import { APIService } from './api.service.js';

const apiService = new APIService('/upgradeScenarios');

export const UpgradeScenariosService = {
	async loadUpgradeScenarios(filter, sort, currentPage, count) {
		return await apiService.get(`/all/${currentPage}/${count}`, { filter, sort });
	},

	async loadTotal(filter) {
		return await apiService.get('/count', { filter });
	},

	async create(upgradeScenarios) {
		return await apiService.post('/save', upgradeScenarios);
	},

	async update(upgradeScenarios) {
		return await apiService.post('/update', upgradeScenarios);
	},

	async delete(upgradeScenarios) {
		return await apiService.post('/delete', upgradeScenarios);
	},

	async getAllUpgradeTypes() {
		return await apiService.get('/upgradeTypes');
	}
};

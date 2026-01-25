/*
 * SPDX-FileCopyrightText: Copyright (c) 2026 NVIDIA CORPORATION & AFFILIATES. All rights reserved.
 * SPDX-License-Identifier: Apache-2.0
 */

import { APIService } from './api.service.js';

const apiService = new APIService('/upgradeStepsScenarios');

export const UpgradeStepsScenariosService = {

	async loadAll() {
		return this.loadUpgradeStepsScenarios({}, {}, 0, 0);
	},

	async loadUpgradeStepsScenarios(filter, sort, currentPage, count) {
		return await apiService.get(`/all/${currentPage}/${count}`, { filter, sort });
	},

	async loadTotal(filter) {
		return await apiService.get('/count', { filter });
	},

	async create(upgradeStepsScenarios) {
		return await apiService.post('/save', upgradeStepsScenarios);
	},

	async update(upgradeStepsScenarios) {
		return await apiService.post('/update', upgradeStepsScenarios);
	},

	async delete(upgradeStepsScenarios) {
		return await apiService.post('/delete', upgradeStepsScenarios);
	}
};

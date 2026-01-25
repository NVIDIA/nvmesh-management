/*
 * SPDX-FileCopyrightText: Copyright (c) 2026 NVIDIA CORPORATION & AFFILIATES. All rights reserved.
 * SPDX-License-Identifier: Apache-2.0
 */

/* global consts */

import { APIService } from './api.service.js';

const apiService = new APIService('/upgradeSteps');

export const UpgradeStepsService = {
	async loadUpgradeSteps(upgradeId, filter, sort, currentPage, count) {
		filter.upgradeID = upgradeId;

		return await apiService.get(`/all/${currentPage}/${count}`, { filter, sort });
	},

	async loadTotalByUpgrade(upgradeId, filter) {
		filter.upgradeID = upgradeId;

		return await apiService.get('/count', { filter });
	},

	async countCompletedSteps(upgradeID) {
		return await this.loadTotalByUpgrade(upgradeID, { status: { $in: consts.completedUpgradeStepStatuses } });
	},

	async setBreakpoint(stepId, isBreakpointSet) {
		return await apiService.post('/setBreakpoint', { upgradeStepID: stepId, isBreakpointSet });
	},

	async markAsCompleted(stepId) {
		return await apiService.post('/markAsCompleted', { upgradeStepID: stepId });
	}
};

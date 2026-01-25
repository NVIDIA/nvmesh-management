/*
 * SPDX-FileCopyrightText: Copyright (c) 2026 NVIDIA CORPORATION & AFFILIATES. All rights reserved.
 * SPDX-License-Identifier: Apache-2.0
 */

import { APIService } from './api.service.js';

const apiService = new APIService('/upgradeAgents');

export const UpgradeAgentsService = {
	async loadTotal(filter) {
		return await apiService.get('/count', { filter });
	},

	async loadUpgradeAgents(filter, sort, currentPage, count) {
		return await apiService.get(`/all/${currentPage}/${count}`, { filter, sort });
	},

	async deleteUpgradeAgents(upgradeAgentIds) {
		return await apiService.post('/delete', upgradeAgentIds);
	},

	async requestFreshKeepalive(upgradeAgentID) {
		return await apiService.post('/keepalive', { _id: upgradeAgentID });
	},
};

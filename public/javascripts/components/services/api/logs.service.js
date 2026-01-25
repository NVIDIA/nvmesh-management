/*
 * SPDX-FileCopyrightText: Copyright (c) 2026 NVIDIA CORPORATION & AFFILIATES. All rights reserved.
 * SPDX-License-Identifier: Apache-2.0
 */

import { APIService } from './api.service.js';

const apiService = new APIService('/logs');

export const LogsService = {
	async loadTotal(filter) {
		return await apiService.get('/count', { filter });
	},

	async loadLogs(filter, sort, currentPage, count) {
		return await apiService.get(`/all/${currentPage}/${count}`, { filter, sort });
	},

	async loadAlertsCount() {
		return await apiService.get('/alerts/count');
	},

	async loadAlerts(filter, sort, currentPage, count) {
		return await apiService.get(`/alerts/${currentPage}/${count}`, { filter, sort });
	},

	async acknowledgeAll() {
		return await apiService.post('/acknowledgeAll');
	},

	async acknowledge(alertId) {
		return await apiService.post('/acknowledge', { id: alertId });
	},
};
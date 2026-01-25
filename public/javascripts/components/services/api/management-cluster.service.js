/*
 * SPDX-FileCopyrightText: Copyright (c) 2026 NVIDIA CORPORATION & AFFILIATES. All rights reserved.
 * SPDX-License-Identifier: Apache-2.0
 */

import { APIService } from './api.service.js';

const apiService = new APIService('/managementCluster');

export const ManagementClusterService = {
	async loadTotal(filter) {
		return await apiService.get('/count', { filter });
	},

	async loadCluster(filter, sort, currentPage, count) {
		return await apiService.get(`/all/${currentPage}/${count}`, { filter, sort });
	},

	async delete(mgmts) {
		return await apiService.post('/delete', mgmts);
	},
};
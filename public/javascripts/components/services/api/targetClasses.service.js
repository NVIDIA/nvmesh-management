/*
 * SPDX-FileCopyrightText: Copyright (c) 2026 NVIDIA CORPORATION & AFFILIATES. All rights reserved.
 * SPDX-License-Identifier: Apache-2.0
 */

import { APIService } from './api.service.js';

const apiService = new APIService('/serverClasses');

export const TargetClassesService = {
	async loadAll() {
		return await apiService.get('/all/0/0');
	},

	async loadTotal(filter) {
		return await apiService.get('/count', { filter });
	},

	async loadTargetClasses(filter, sort, currentPage, count) {
		return await apiService.get(`/all/${currentPage}/${count}`, { filter, sort });
	},

	async create(targetClasses) {
		return await apiService.post('/save', targetClasses);
	},

	async update(targetClasses) {
		return await apiService.post('/update', targetClasses);
	},

	async delete(targetClasses) {
		return await apiService.post('/delete', targetClasses);
	},

	async getDomains(projection) {
		return await apiService.get('/getDomains', projection ? { projection } : { }, { disableParamsAsJSON: true });
	},
};
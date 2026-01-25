/*
 * SPDX-FileCopyrightText: Copyright (c) 2026 NVIDIA CORPORATION & AFFILIATES. All rights reserved.
 * SPDX-License-Identifier: Apache-2.0
 */

import { APIService } from './api.service.js';

const apiService = new APIService('/components');

export const ComponentsService = {
	async loadTotal(filter) {
		return await apiService.get('/count', { filter });
	},

	async loadComponentVersions(filter, sort, currentPage, count) {
		return await apiService.get(`/all/${currentPage}/${count}`, { filter, sort });
	},

	async create(components) {
		return await apiService.post('/save', components);
	},

	async update(components) {
		return await apiService.post('/update', components);
	},

	async delete(components) {
		return await apiService.post('/delete', components);
	},

	async getAllComponentTypes() {
		return await apiService.get('/getAllComponentTypes');
	},

	async loadComponents(filter, sort, currentPage = 0, count = 0, eagerLoading = false) {
		return await apiService.get(`/componentsAll/${currentPage}/${count}`, { filter, sort, eagerLoading });
	},

	async countComponents(filter) {
		return await apiService.get('/countComponents', { filter });
	},

	async getComponentsByTypeID(componentTypeID) {
		return await apiService.get(`/getComponentsByTypeID/${componentTypeID}`);
	}
};

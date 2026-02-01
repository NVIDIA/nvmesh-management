/*
 * SPDX-FileCopyrightText: Copyright (c) 2026 NVIDIA CORPORATION & AFFILIATES. All rights reserved.
 * SPDX-License-Identifier: Apache-2.0
 */

import { APIService } from './api.service.js';

const apiService = new APIService('/volumeSecurityGroups');

export const VolumeSecurityGroupsService = {
	async loadAll() {
		return await apiService.get('/all/0/0');
	},

	async loadTotal(filter) {
		return await apiService.get('/count', { filter });
	},

	async loadVolumeSecurityGroups(filter, sort, currentPage, count) {
		return await apiService.get(`/all/${currentPage}/${count}`, { filter, sort });
	},

	async create(volumeSecurityGroups) {
		return await apiService.post('/save', volumeSecurityGroups);
	},

	async update(volumeSecurityGroups) {
		return await apiService.post('/update', volumeSecurityGroups);
	},

	async delete(volumeSecurityGroups) {
		return await apiService.post('/delete', volumeSecurityGroups);
	},
};

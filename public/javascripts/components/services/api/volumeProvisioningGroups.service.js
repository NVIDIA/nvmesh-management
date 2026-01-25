/*
 * SPDX-FileCopyrightText: Copyright (c) 2026 NVIDIA CORPORATION & AFFILIATES. All rights reserved.
 * SPDX-License-Identifier: Apache-2.0
 */

import { APIService } from './api.service.js';

const apiService = new APIService('/volumeProvisioningGroups');

export const VolumeProvisioningGroupsService = {
	async getAll() {
		return await apiService.get('/all/0/0');
	},

	async loadTotal(filter) {
		return await apiService.get('/count', { filter });
	},

	async loadVPGs(filter, sort, currentPage, count) {
		return await apiService.get(`/all/${currentPage}/${count}`, { filter, sort });
	},

	async loadVPGById(vpgId) {
		return await apiService.get(`/${vpgId}`);
	},

	async create(vpgs) {
		return await apiService.post('/save', vpgs);
	},

	async update(vpgs) {
		return await apiService.post('/update', vpgs);
	},

	async delete(vpgs) {
		return await apiService.post('/delete', vpgs);
	},

	async extend(vpg) {
		return await apiService.post('/extend', vpg);
	},

	async getDisksById(vpgId) {
		return await apiService.get(`/getDisksByID/${vpgId}`);
	}
};

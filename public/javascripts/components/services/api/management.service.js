/*
 * SPDX-FileCopyrightText: Copyright (c) 2026 NVIDIA CORPORATION & AFFILIATES. All rights reserved.
 * SPDX-License-Identifier: Apache-2.0
 */

import { APIService } from './api.service.js';

const apiService = new APIService();

export const ManagementService = {
	async getSpaceAllocation() {
		return await apiService.get('/getSpaceAllocation');
	},

	async getCounters() {
		return await apiService.get('/getCounters');
	},

	async getVolumeCounters() {
		return await apiService.get('/getVolumeCounters');
	},

	async resetVolumeStatuses() {
		return await apiService.post('/resetVolumeStatuses');
	},

	async getSystemInfo() {
		return await apiService.get('/systemInfo');
	},

	async getAboutInfo() {
		return await apiService.get('/aboutInfo');
	}
};

export default ManagementService;
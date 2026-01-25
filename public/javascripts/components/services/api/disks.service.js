/*
 * SPDX-FileCopyrightText: Copyright (c) 2026 NVIDIA CORPORATION & AFFILIATES. All rights reserved.
 * SPDX-License-Identifier: Apache-2.0
 */

import { APIService } from './api.service.js';

const apiService = new APIService('/disks');

export const DisksService = {
	async loadAll() {
		const res = await apiService.get('/all/0/0');
		return res.edges;
	},

	async load(filter, sort, currentPage, count) {
		const res = await apiService.get(`/all/${currentPage}/${count}`, { filter, sort });
		return res.edges;
	},

	async loadTotal(filter) {
		return await apiService.get('/count', { filter });
	},

	async getDisksByNodes(nodeIds) {
		return await apiService.post('/disksByNodes', nodeIds);
	},

	async deleteDisks(disks) {
		return await apiService.post('/delete', disks);
	},

	async formatDisks(disks) {
		return await apiService.post('/formatDiskByIDsAndUUIDs', { disks });
	},

	async evictDisks(disks) {
		return await apiService.post('/evictDiskByDiskIDsAndUUIDs', disks);
	},

	async loadDiskSegments(diskID, serverID, filter, sort, page, count, options) {
		return await apiService.get(`/segments/${page}/${count}`, { diskID, serverID, filter, sort }, options);
	},
};

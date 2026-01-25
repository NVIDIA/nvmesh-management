/*
 * SPDX-FileCopyrightText: Copyright (c) 2026 NVIDIA CORPORATION & AFFILIATES. All rights reserved.
 * SPDX-License-Identifier: Apache-2.0
 */

import { APIService } from './api.service.js';

const apiService = new APIService('/backups');

export const BackupsService = {
	async loadTotal(filter) {
		return await apiService.get('/count', { filter });
	},

	async loadBackups(filter, sort, currentPage, count) {
		return await apiService.get(`/all/${currentPage}/${count}`, { filter, sort });
	},
};
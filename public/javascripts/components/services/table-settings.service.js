/*
 * SPDX-FileCopyrightText: Copyright (c) 2026 NVIDIA CORPORATION & AFFILIATES. All rights reserved.
 * SPDX-License-Identifier: Apache-2.0
 */

import { CacheService } from './cache.service.js';

const CACHE_KEY = 'table-user-cache';
const cacheService = new CacheService(CACHE_KEY);
export const tableSettingsService = {

	getTableSettings(tableId) {
		const cache = cacheService.loadCache();
		return cache[tableId] || {};
	},

	setTableSettings(tableId, cache) {
		const currCache = cacheService.loadCache();
		cacheService.saveCache({
			...currCache,
			[tableId]: cache
		});
	},
};
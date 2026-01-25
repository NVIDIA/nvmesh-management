/*
 * SPDX-FileCopyrightText: Copyright (c) 2026 NVIDIA CORPORATION & AFFILIATES. All rights reserved.
 * SPDX-License-Identifier: Apache-2.0
 */

export class CacheService {
	constructor(key) {
		this.key = key;
	}

	loadCache() {
		const cache = localStorage.getItem(this.key);
		return cache ? JSON.parse(cache) : {};
	}

	saveCache(cache) {
		localStorage.setItem(this.key, JSON.stringify(cache));
	}
}
/*
 * SPDX-FileCopyrightText: Copyright (c) 2026 NVIDIA CORPORATION & AFFILIATES. All rights reserved.
 * SPDX-License-Identifier: Apache-2.0
 */

import { APIService } from './api.service.js';

const apiService = new APIService('/upgrades');

export const UpgradesService = {
	async loadUpgrades(filter, sort, currentPage, count) {
		return await apiService.get(`/all/${currentPage}/${count}`, { filter, sort });
	},

	async loadTotal(filter) {
		return await apiService.get('/count', { filter });
	},

	async getUpgradeByID(upgradeId) {
		return await apiService.get(`/${upgradeId}`);
	},

	async create(upgrade) {
		return await apiService.post('/save', upgrade);
	},

	async update(upgrade) {
		return await apiService.post('/update', upgrade);
	},

	async delete(upgrades) {
		return await apiService.post('/delete', upgrades);
	},

	async getPossibleUpgradesByHostnames(hostnames, components) {
		const body = { hostnames };

		if (components)
			body.components = components;

		return await apiService.post('/getPossibleUpgradesByHostnames', body);
	},

	async startUpgrade(upgrade) {
		return await apiService.post('/startUpgrade', upgrade);
	},

	async resumeUpgrade(upgrade) {
		return await apiService.post('/resumeUpgrade', upgrade);
	},

	async skipFailedMachine(upgrade) {
		return await apiService.post('/skipFailedMachine', upgrade);
	}
};
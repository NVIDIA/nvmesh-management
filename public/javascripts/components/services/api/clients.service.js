/*
 * SPDX-FileCopyrightText: Copyright (c) 2026 NVIDIA CORPORATION & AFFILIATES. All rights reserved.
 * SPDX-License-Identifier: Apache-2.0
 */

import { APIService } from './api.service.js';

const apiService = new APIService('/clients');

export const ClientsService = {
	async loadAll(filter, projection) {
		return await apiService.get('/all/0/0', { filter, projection });
	},

	async loadTotal(filter) {
		return await apiService.get('/count', { filter });
	},

	async loadClients(filter, sort, currentPage, count) {
		return await apiService.get(`/all/${currentPage}/${count}`, { filter, sort });
	},

	async loadClient(id) {
		return await apiService.get(`/${id}`);
	},

	async delete(clients) {
		return await apiService.post('/delete', clients);
	},

	async attach(payload) {
		return await apiService.post('/attach', payload);
	},

	async detach(payload) {
		return await apiService.post('/detach', payload);
	},

	async setEmulationMode(payload) {
		return await apiService.post('/setEmulationMode', payload);
	},
};

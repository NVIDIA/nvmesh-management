/*
 * SPDX-FileCopyrightText: Copyright (c) 2026 NVIDIA CORPORATION & AFFILIATES. All rights reserved.
 * SPDX-License-Identifier: Apache-2.0
 */

import { APIService } from './api.service.js';

const apiService = new APIService('/volumes');

export const VolumesService = {
	async getAll(filter = {}, projection = {}) {
		return await apiService.get('/all/0/0', { filter, projection });
	},

	async loadTotal(filter) {
		return await apiService.get('/count', { filter });
	},

	async loadVolumes(filter, sort, currentPage, count, projection = {}) {
		return await apiService.get(`/all/${currentPage}/${count}`, { filter, sort, projection });
	},

	async getById(id) {
		return await apiService.get(`/${id}`);
	},

	async create(volume) {
		return await apiService.post('/save', volume);
	},

	async update(volume) {
		return await apiService.post('/update', volume);
	},

	async delete(volumes) {
		return await apiService.post('/delete', volumes);
	},

	async rebuild(volumes) {
		return await apiService.post('/rebuildVolumes', volumes);
	},

	async acknowledgeEncryptionError(encryptionCommand) {
		return await apiService.post('/acknowledgeResponse', encryptionCommand);
	},

	async initEncryption(encryptionCommand) {
		return await apiService.post('/initEncryption', encryptionCommand);
	},

	async addPassphrase(encryptionCommand) {
		return await apiService.post('/addPassphrase', encryptionCommand);
	},

	async deletePassphrase(encryptionCommand) {
		return await apiService.post('/deletePassphrase', encryptionCommand);
	},

	async rotatePassphrase(encryptionCommand) {
		return await apiService.post('/rotatePassphrase', encryptionCommand);
	},

	async extend(volumes) {
		return await apiService.post('/extend', volumes);
	},

	async cloneVPGProperties(volume) {
		return await apiService.post('/cloneVPGProperties', volume);
	},

	async getVolumeDiagram(volumeId) {
		return await apiService.get(`/getVolumeDiagram/${volumeId}`);
	},

	async getSegmentsStatusByDisk(params) {
		return await apiService.get('/getSegmentsStatusByDisk', params, { disableParamsAsJSON: true });
	},

	async getLargestVolumes() {
		return await apiService.get('/getLargestVolumes');
	},

	async getCDVs() {
		return await apiService.get('/all/0/0', {
			filter: { volumeClass: 'CDV' },
			projection: { _id: 1, uuid: 1, name: 1, capacity: 1, cdvConfig: 1, tpvCount: 1 }
		});
	},

	async createTPV(tpv) {
		return await apiService.post('/save', tpv);
	},

	async updateTPV(tpv) {
		return await apiService.post('/tpv/update', tpv);
	},

	async deleteTPV(tpvIds) {
		return await apiService.post('/tpv/delete', tpvIds);
	},

	async extendTPV(data) {
		return await apiService.post('/tpv/extend', data);
	},
};

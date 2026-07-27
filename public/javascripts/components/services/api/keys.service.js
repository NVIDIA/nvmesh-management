import { APIService } from './api.service.js';

const apiService = new APIService('/keys');

export const KeysService = {
	async loadTotal(filter) {
		return await apiService.get('/count', { filter });
	},

	async loadKeys(filter, sort, currentPage, count) {
		return await apiService.get(`/all/${currentPage}/${count}`, { filter, sort });
	},

	async create(keys) {
		return await apiService.post('/save', keys);
	},

	async update(keys) {
		return await apiService.post('/update', keys);
	},

	async delete(keys) {
		return await apiService.post('/delete', keys);
	},
};
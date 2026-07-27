import { APIService } from './api.service.js';

const apiService = new APIService('/ofeds');

export const OfedsService = {
	async loadTotal(filter) {
		return await apiService.get('/count', { filter });
	},

	async loadOfeds(filter, sort, currentPage, count) {
		return await apiService.get(`/all/${currentPage}/${count}`, { filter, sort });
	},

	async create(ofeds) {
		return await apiService.post('/save', ofeds);
	},

	async update(ofeds) {
		return await apiService.post('/update', ofeds);
	},

	async delete(ofeds) {
		return await apiService.post('/delete', ofeds);
	},
};
import { APIService } from './api.service.js';

const apiService = new APIService('/platforms');

export const PlatformsService = {
	async loadAll() {
		return await apiService.get('/all/0/0');
	},

	async loadTotal(filter) {
		return await apiService.get('/count', { filter });
	},

	async loadPlatforms(filter, sort, currentPage, count) {
		return await apiService.get(`/all/${currentPage}/${count}`, { filter, sort });
	},

	async create(platforms) {
		return await apiService.post('/save', platforms);
	},

	async update(platforms) {
		return await apiService.post('/update', platforms);
	},

	async delete(platforms) {
		return await apiService.post('/delete', platforms);
	},

	async getAllArchTypes() {
		return await apiService.get('/getAllArchTypes');
	},
};

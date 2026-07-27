import { APIService } from './api.service.js';

const apiService = new APIService('/releases');

export const ReleasesService = {
	async loadAll() {
		return await apiService.get('/all/0/0');
	},

	async loadTotal(filter) {
		return await apiService.get('/count', { filter });
	},

	async loadReleases(filter, sort, currentPage, count) {
		return await apiService.get(`/all/${currentPage}/${count}`, { filter, sort });
	},

	async create(releases) {
		return await apiService.post('/save', releases);
	},

	async update(releases) {
		return await apiService.post('/update', releases);
	},

	async delete(releases) {
		return await apiService.post('/delete', releases);
	},
};

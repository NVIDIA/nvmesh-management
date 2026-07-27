import { APIService } from './api.service.js';

const apiService = new APIService('/artifacts');

export const ArtifactsService = {
	async loadAll() {
		return await apiService.get('/all/0/0');
	},

	async loadTotal(filter) {
		return await apiService.get('/count', { filter });
	},

	async loadArtifacts(filter, sort, currentPage, count) {
		return await apiService.get(`/all/${currentPage}/${count}`, { filter, sort });
	},

	async create(artifacts) {
		return await apiService.post('/save', artifacts);
	},

	async update(artifacts) {
		return await apiService.post('/update', artifacts);
	},

	async delete(artifacts) {
		return await apiService.post('/delete', artifacts);
	},

};

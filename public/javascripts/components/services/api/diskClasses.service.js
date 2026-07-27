import { APIService } from './api.service.js';

const apiService = new APIService('/diskClasses');

export const DiskClassesService = {
	async loadAll() {
		return await apiService.get('/all/0/0');
	},

	async loadTotal(filter) {
		return await apiService.get('/count', { filter });
	},

	async load(filter, sort, currentPage, count) {
		return await apiService.get(`/all/${currentPage}/${count}`, { filter, sort });
	},

	async create(DiskClasses) {
		return await apiService.post('/save', DiskClasses);
	},

	async update(DiskClasses) {
		return await apiService.post('/update', DiskClasses);
	},

	async delete(DiskClasses) {
		return await apiService.post('/delete', DiskClasses);
	},
	
	async getDisksByServerAndDiskClasses(body) {
		return await apiService.post('/getDisksByServerAndDiskClasses', body);
	},

	async getDomains(projection) {
		return await apiService.get('/getDomains', projection ? { projection } : { }, { disableParamsAsJSON: true });
	},
};
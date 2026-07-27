import { APIService } from './api.service.js';

const apiService = new APIService('/mongoDB');

export const MongoDBService = {
	async loadTotal(filter) {
		return await apiService.get('/count', { filter });
	},

	async loadAll() {
		return await apiService.get('/all');
	},
};

import { APIService } from './api.service.js';

const apiService = new APIService('/generalSettings');

export const GeneralSettingsService = {
	async load() {
		return await apiService.get('/load');
	},

	async update(generalSettings) {
		return await apiService.post('/update', generalSettings);
	},
};

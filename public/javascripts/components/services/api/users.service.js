import { APIService } from './api.service.js';

const apiService = new APIService('/users');

export const UsersService = {
	async loadTotal(filter) {
		return await apiService.get('/count', { filter });
	},

	async loadAll(filter, sort) {
		return await apiService.get('/all', { filter, sort });
	},

	async changePassword(data) {
		return await apiService.post('/changePassword', data);
	},

	async deleteUsers(users) {
		return await apiService.post('/delete', users);
	},

	async createUsers(users) {
		return await apiService.post('/save', users);
	},

	async updateUsers(users) {
		return await apiService.post('/update', users);
	},
	async disconnectUsers(users) {
		return await apiService.post('/disconnect', users);
	},

	async getConcurrentSessions() {
		return await apiService.get('/concurrentSessions');
	},

	async getDefaultDomain() {
		return await apiService.get('/getDefaultDomain');
	},

	async getPhoneHomeUser() {
		return await apiService.get('/getPhoneHomeUser');
	},

};

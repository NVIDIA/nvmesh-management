import { RequestService } from '../request.service.js';
import { AlertRef } from '../../core/Alert.js';

export class APIService {
	constructor(apiBaseUrl = '') {
		this.apiBaseUrl = apiBaseUrl;
	}

	async get(endpoint, queryParams = {}, reqOptions = {}) {
		try {
			return await RequestService.get(`${this.apiBaseUrl}${endpoint}`, queryParams, reqOptions);
		} catch (err) {
			AlertRef.getInstance().errorAlert(`Request to ${this.apiBaseUrl}${endpoint} failed - ${err}`);
			throw err;
		}
	}

	async post(endpoint, body = {}, reqOptions = {}) {
		try {
			return await RequestService.post(`${this.apiBaseUrl}${endpoint}`, body, reqOptions);
		} catch (err) {
			AlertRef.getInstance().errorAlert(`Request to ${this.apiBaseUrl}${endpoint} failed - ${err}`);
			throw err;
		}
	}
}
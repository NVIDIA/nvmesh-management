/*
 * SPDX-FileCopyrightText: Copyright (c) 2026 NVIDIA CORPORATION & AFFILIATES. All rights reserved.
 * SPDX-License-Identifier: Apache-2.0
 */

const Strategy = require('passport-strategy');
const consts = require('../consts.js');
const utils = require('../utils.js');

class ClientCertStrategy extends Strategy {
	constructor(verify) {
		super();

		this.name = consts.passportStrategies.CLIENT_CERT;
		this.verify = verify;
	}

	authenticate(req) {
		// Requests must be authorized
		// (i.e. the certificate must be signed by at least one trusted CA)
		if (!req.socket.authorized) {
			this.fail();
		} else {
			const clientCert = req.socket.getPeerCertificate();

			if (!clientCert || utils.isEmpty(clientCert)) {
				this.fail({ message: 'Missing client cert.' });
			} else {
				const verified = (err, user, info) => {
					if (err)
						return this.error(err);
					if (!user)
						return this.fail(info);

					this.success(user, info);
				};

				this.verify(clientCert, verified);
			}
		}
	}
}


exports.Strategy = ClientCertStrategy;

/*
 * SPDX-FileCopyrightText: Copyright (c) 2026 NVIDIA CORPORATION & AFFILIATES. All rights reserved.
 * SPDX-License-Identifier: Apache-2.0
 */

/* global app */
const { compareVersionRelease } = require('./versionUtils.js');

var scope = {};
module.exports = scope;

// this function creates a proxy that intercepts the class function callings
// in case the function that is being called exists in the calss it will call it,
// otherwise it will pass the call to the original class by using the originalClassAttributeName
// that represents the name of the attribute that is holding an instance of the original class within the targetClass
function createClassProxy(targetClass, originalClassAttributeName) {
	return new Proxy(targetClass, {
		get(target, prop) {
			if (typeof target[prop] === 'function') {
				// Existing method in MongoDBWrapper - return it
				return (...args) => target[prop](...args);
			} else {
				// Non-existent method - call it from the original class
				return (...args) => target[originalClassAttributeName][prop](...args);
			}
		}
	});
}

// mimics db (creates an isulated instance of collection with the relevant mongo functions)
scope.MongoDBWrapper = class MongoDBWrapper {
	constructor(db) {
		this.originalDB = db;
	}

	// private
	_createCollectionWrapper(collectionName) {
		let mongoDBCollectionWrapper = new scope.MongoDBCollectionWrapper(collectionName, this.originalDB);
		return mongoDBCollectionWrapper.createOriginalCollectionProxy();
	}

	collection(collectionName) {
		return this._createCollectionWrapper(collectionName);
	}

	getCollection(collectionName) {
		return this._createCollectionWrapper(collectionName);
	}

	// this function creates a proxy that intercepts the class function callings
	// in case the function that is being called exists in the calss it will call it,
	// otherwise it will pass the call to the originalDB
	createOriginalDBProxy() {
		return createClassProxy(this, 'originalDB');
	}
};

scope.MongoDBCollectionWrapper = class MongoDBCollectionWrapper {
	constructor(collectionName, originalDB) {
		this.originalDB = originalDB;
		this.collectionName = collectionName;
		this.originalCollection = this.originalDB.collection(this.collectionName);
		this.supportedDBCollectionVersions = app.get('supportedDBCollectionVersions');

		let collectionDocVersions = this.supportedDBCollectionVersions[this.collectionName];
		if (collectionDocVersions && collectionDocVersions.length)
			this.docVersion = collectionDocVersions.sort(compareVersionRelease)[collectionDocVersions.length - 1];
	}

	// this function creates a proxy that intercepts the class function callings
	// in case the function that is being called exists in the class it will call it,
	// otherwise it will pass the call to the originalCollection
	createOriginalCollectionProxy() {
		return createClassProxy(this, 'originalCollection');
	}

	// private function to add the docVersion if needed
	addDocVersionForUpdateIfNeeded(...args) {
		// checking that the third arg is not the callback function, meaninng that it is the options
		// then, we can check for upsert=true and add the docVersion
		if (args.length > 2 && typeof args[2] !== 'function' && args[2].upsert) {
			let update = args[1];

			// in case of an update pipline, insert the docVersion save stage as the first stage
			if (Array.isArray(update))
				update = update.concat([{ $set: { docVersion: this.docVersion } }], update);
			else {
				if (!('$setOnInsert' in update))
					update['$setOnInsert'] = {};

				update['$setOnInsert'].docVersion = this.docVersion;
			}
		}
	}

	insertOne(...args) {
		args[0].docVersion = this.docVersion;

		this.originalCollection.insertOne(...args);
	}

	insertMany(...args) {
		args[0].forEach((obj) => obj.docVersion = this.docVersion);

		this.originalCollection.insertMany(...args);
	}

	updateOne(...args) {
		this.addDocVersionForUpdateIfNeeded(...args);
		this.originalCollection.updateOne(...args);
	}

	updateMany(...args) {
		this.addDocVersionForUpdateIfNeeded(...args);
		this.originalCollection.updateMany(...args);
	}

	findOneAndUpdate(...args) {
		this.addDocVersionForUpdateIfNeeded(...args);
		this.originalCollection.findOneAndUpdate(...args);
	}

	getOriginalCollection() {
		return this.originalCollection;
	}
};

module.exports = scope;

/*
 * SPDX-FileCopyrightText: Copyright (c) 2026 NVIDIA CORPORATION & AFFILIATES. All rights reserved.
 * SPDX-License-Identifier: Apache-2.0
 */

exports.Entity = class Entity {
	preSave() {
		return JSON.parse(JSON.stringify(this));
	}

	save() {
		let derivedClassName = this.constructor.name;
		throw new Error(`Not Implemented. ${derivedClassName} does not implements save() method`);
	}

	afterSave(volumeJson) {} // eslint-disable-line no-unused-vars
};

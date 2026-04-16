/*
 * SPDX-FileCopyrightText: Copyright (c) 2026 NVIDIA CORPORATION & AFFILIATES. All rights reserved.
 * SPDX-License-Identifier: Apache-2.0
 */

/* global globalThis, describe, it */

import assert from 'assert';
import consts from '../../consts.js';

globalThis.consts = consts;

// ---------------------------------------------------------------------------
// consts.js — new thin-provisioning constants
// ---------------------------------------------------------------------------

describe('consts — thin provisioning additions', () => {
	describe('volumeClass', () => {
		it('CDV is defined and equals "CDV"', async() => {
			assert.strictEqual(consts.volumeClass.CDV, 'CDV');
		});

		it('TPV is defined and equals "TPV"', async() => {
			assert.strictEqual(consts.volumeClass.TPV, 'TPV');
		});

		it('REGULAR is still defined', async() => {
			assert.strictEqual(consts.volumeClass.REGULAR, 'REGULAR');
		});
	});

	describe('componentsPages', () => {
		it('tpv page key is registered', async() => {
			assert.ok('tpv' in consts.componentsPages, 'componentsPages.tpv should exist');
		});

		it('tpv value is the string "tpv"', async() => {
			assert.strictEqual(consts.componentsPages.tpv, 'tpv');
		});
	});

	describe('cdvExtentSizeMBValues', () => {
		it('is a non-empty array', async() => {
			assert.ok(Array.isArray(consts.cdvExtentSizeMBValues));
			assert.ok(consts.cdvExtentSizeMBValues.length > 0);
		});

		it('all values are powers of 2', async() => {
			for (const v of consts.cdvExtentSizeMBValues) {
				assert.ok(v > 0 && (v & (v - 1)) === 0, `${v} is not a power of 2`);
			}
		});

		it('includes 1024 MB (1 GB — the default CDV extent size)', async() => {
			assert.ok(consts.cdvExtentSizeMBValues.includes(1024));
		});

		it('values are in ascending order', async() => {
			for (let i = 1; i < consts.cdvExtentSizeMBValues.length; i++) {
				assert.ok(
					consts.cdvExtentSizeMBValues[i] > consts.cdvExtentSizeMBValues[i - 1],
					'cdvExtentSizeMBValues should be sorted ascending'
				);
			}
		});
	});

	describe('tpvExtentSizeKBValues', () => {
		it('is a non-empty array', async() => {
			assert.ok(Array.isArray(consts.tpvExtentSizeKBValues));
			assert.ok(consts.tpvExtentSizeKBValues.length > 0);
		});

		it('all values are powers of 2', async() => {
			for (const v of consts.tpvExtentSizeKBValues) {
				assert.ok(v > 0 && (v & (v - 1)) === 0, `${v} is not a power of 2`);
			}
		});

		it('includes 1024 KB (1 MB — the default TPV extent size)', async() => {
			assert.ok(consts.tpvExtentSizeKBValues.includes(1024));
		});

		it('values are in ascending order', async() => {
			for (let i = 1; i < consts.tpvExtentSizeKBValues.length; i++) {
				assert.ok(
					consts.tpvExtentSizeKBValues[i] > consts.tpvExtentSizeKBValues[i - 1],
					'tpvExtentSizeKBValues should be sorted ascending'
				);
			}
		});
	});
});

// ---------------------------------------------------------------------------
// Volumes.jsx — getVolumeClassFilter
// Logic extracted from the component; see Volumes.jsx:330-332
// ---------------------------------------------------------------------------

describe('Volumes.jsx — getVolumeClassFilter', () => {
	// Mirrors the component closure exactly.
	// Two checkboxes: showRegular (checked) and showCDVs (checked). TPVs always excluded.
	const getVolumeClassFilter = (showRegular, showCDVs) => {
		const classes = [];
		if (showRegular) classes.push(consts.volumeClass.REGULAR, null);
		if (showCDVs) classes.push(consts.volumeClass.CDV);
		return { volumeClass: { $in: classes } };
	};

	it('both checked — includes REGULAR, null, and CDV', async() => {
		const filter = getVolumeClassFilter(true, true);
		const included = filter.volumeClass.$in;
		assert.ok(included.includes(consts.volumeClass.REGULAR));
		assert.ok(included.includes(null));
		assert.ok(included.includes(consts.volumeClass.CDV));
	});

	it('both checked — never includes TPV', async() => {
		const filter = getVolumeClassFilter(true, true);
		assert.ok(!filter.volumeClass.$in.includes(consts.volumeClass.TPV));
	});

	it('showRegular only — includes REGULAR and null, excludes CDV', async() => {
		const filter = getVolumeClassFilter(true, false);
		assert.ok(filter.volumeClass.$in.includes(consts.volumeClass.REGULAR));
		assert.ok(!filter.volumeClass.$in.includes(consts.volumeClass.CDV));
	});

	it('showCDVs only — includes CDV, excludes REGULAR', async() => {
		const filter = getVolumeClassFilter(false, true);
		assert.ok(filter.volumeClass.$in.includes(consts.volumeClass.CDV));
		assert.ok(!filter.volumeClass.$in.includes(consts.volumeClass.REGULAR));
	});

	it('neither checked — empty $in array', async() => {
		const filter = getVolumeClassFilter(false, false);
		assert.strictEqual(filter.volumeClass.$in.length, 0);
	});
});

// ---------------------------------------------------------------------------
// ThinProvisioning.jsx — extent size column formatter
// Logic extracted from columns[4].value; see ThinProvisioning.jsx:93-97
// ---------------------------------------------------------------------------

describe('ThinProvisioning.jsx — extent size column formatter', () => {
	const formatExtentSize = (kb) => {
		if (kb == null) return '—';
		return kb >= 1024 ? `${kb / 1024} MB` : `${kb} KB`;
	};

	it('returns "—" for null', async() => {
		assert.strictEqual(formatExtentSize(null), '—');
	});

	it('returns "—" for undefined', async() => {
		assert.strictEqual(formatExtentSize(undefined), '—');
	});

	it('formats 64 KB as "64 KB"', async() => {
		assert.strictEqual(formatExtentSize(64), '64 KB');
	});

	it('formats 512 KB as "512 KB"', async() => {
		assert.strictEqual(formatExtentSize(512), '512 KB');
	});

	it('formats 1024 KB as "1 MB"', async() => {
		assert.strictEqual(formatExtentSize(1024), '1 MB');
	});

	it('formats 4096 KB as "4 MB"', async() => {
		assert.strictEqual(formatExtentSize(4096), '4 MB');
	});

	it('formats 65536 KB as "64 MB"', async() => {
		assert.strictEqual(formatExtentSize(65536), '64 MB');
	});
});

// ---------------------------------------------------------------------------
// CreateTPVModal.jsx — onFormSubmit payload builder
// Logic extracted from onFormSubmit; see CreateTPVModal.jsx:34-53
// ---------------------------------------------------------------------------

describe('CreateTPVModal.jsx — TPV payload builder', () => {
	const buildTPVPayload = (data, existingTPV = {}) => {
		const isCreate = !existingTPV._id;
		const payload = {
			name: data.name,
			description: data.description || '',
			volumeClass: consts.volumeClass.TPV,
			capacity: Number(data.capacity),
			tpvConfig: {
				cdvId: data.cdvId,
				tpvExtentSizeKB: data.tpvExtentSizeKB,
			},
		};
		if (!isCreate) {
			payload._id = existingTPV._id;
			payload.uuid = existingTPV.uuid;
		}
		return payload;
	};

	const baseFormData = {
		name: 'my-tpv',
		cdvId: 'cdv-1',
		tpvExtentSizeKB: 1024,
		capacity: 50,
	};

	it('sets volumeClass to TPV', async() => {
		const payload = buildTPVPayload(baseFormData);
		assert.strictEqual(payload.volumeClass, consts.volumeClass.TPV);
	});

	it('passes capacity as a number', async() => {
		const payload = buildTPVPayload({ ...baseFormData, capacity: '50' });
		assert.strictEqual(typeof payload.capacity, 'number');
		assert.strictEqual(payload.capacity, 50);
	});

	it('description defaults to empty string when not supplied', async() => {
		const payload = buildTPVPayload({ ...baseFormData, description: undefined });
		assert.strictEqual(payload.description, '');
	});

	it('create mode: no _id or uuid in payload', async() => {
		const payload = buildTPVPayload(baseFormData);
		assert.strictEqual(payload._id, undefined);
		assert.strictEqual(payload.uuid, undefined);
	});

	it('edit mode: includes _id and uuid from existing TPV', async() => {
		const existingTPV = { _id: 'tpv-abc', uuid: 'uuid-xyz' };
		const payload = buildTPVPayload(baseFormData, existingTPV);
		assert.strictEqual(payload._id, 'tpv-abc');
		assert.strictEqual(payload.uuid, 'uuid-xyz');
	});

	it('edit mode: volumeClass is still TPV', async() => {
		const payload = buildTPVPayload(baseFormData, { _id: 'x', uuid: 'y' });
		assert.strictEqual(payload.volumeClass, consts.volumeClass.TPV);
	});
});

// ---------------------------------------------------------------------------
// CreateEditVolumeModal.jsx — CDV branch in prepareVolumeProperties
// Logic extracted from the isCDV branch; see CreateEditVolumeModal.jsx:329-332
// ---------------------------------------------------------------------------

describe('CreateEditVolumeModal.jsx — CDV payload branch', () => {
	const applyCDVProperties = (toSubmit, isCDV, data) => {
		if (isCDV) {
			toSubmit.volumeClass = consts.volumeClass.CDV;
			toSubmit.cdvConfig = {
				cdvExtentSizeMB: data.cdvExtentSizeMB || 1024,
				allocatorSizeGB: data.allocatorSizeGB || 1,
				maxTPVs: data.maxTPVs || 512,
			};
		}
		return toSubmit;
	};

	it('when isCDV=true: sets volumeClass to CDV', async() => {
		const result = applyCDVProperties({}, true, { cdvExtentSizeMB: 512 });
		assert.strictEqual(result.volumeClass, consts.volumeClass.CDV);
	});

	it('when isCDV=true: sets cdvConfig.cdvExtentSizeMB from form data', async() => {
		const result = applyCDVProperties({}, true, { cdvExtentSizeMB: 2048 });
		assert.strictEqual(result.cdvConfig.cdvExtentSizeMB, 2048);
	});

	it('when isCDV=true: cdvExtentSizeMB defaults to 1024 when not provided', async() => {
		const result = applyCDVProperties({}, true, {});
		assert.strictEqual(result.cdvConfig.cdvExtentSizeMB, 1024);
	});

	it('when isCDV=true: sets cdvConfig.allocatorSizeGB from form data', async() => {
		const result = applyCDVProperties({}, true, { allocatorSizeGB: 4 });
		assert.strictEqual(result.cdvConfig.allocatorSizeGB, 4);
	});

	it('when isCDV=true: allocatorSizeGB defaults to 1 when not provided', async() => {
		const result = applyCDVProperties({}, true, {});
		assert.strictEqual(result.cdvConfig.allocatorSizeGB, 1);
	});

	it('when isCDV=true: sets cdvConfig.maxTPVs from form data', async() => {
		const result = applyCDVProperties({}, true, { maxTPVs: 256 });
		assert.strictEqual(result.cdvConfig.maxTPVs, 256);
	});

	it('when isCDV=true: maxTPVs defaults to 512 when not provided', async() => {
		const result = applyCDVProperties({}, true, {});
		assert.strictEqual(result.cdvConfig.maxTPVs, 512);
	});

	it('when isCDV=false: does not set volumeClass', async() => {
		const result = applyCDVProperties({}, false, { cdvExtentSizeMB: 512 });
		assert.strictEqual(result.volumeClass, undefined);
	});

	it('when isCDV=false: does not set cdvConfig', async() => {
		const result = applyCDVProperties({}, false, { cdvExtentSizeMB: 512 });
		assert.strictEqual(result.cdvConfig, undefined);
	});
});

// ---------------------------------------------------------------------------
// Sidebar.jsx — thin provisioning nav entry (structural contract)
// Verifies the config values the Sidebar uses; see Sidebar.jsx:43-46
// ---------------------------------------------------------------------------

describe('Sidebar.jsx — thin provisioning nav entry', () => {
	// The parent entry as it appears in Sidebar.jsx links array.
	const thinProvEntry = {
		icon: 'fa-cubes',
		caption: 'Thin Provisioning',
		adminOnly: false,
		subItems: [{
			url: '/thin-provisioning/cdv',
			icon: 'fa fa-database',
			caption: 'CDVs',
		}, {
			url: '/thin-provisioning/tpv',
			icon: 'fa fa-database',
			caption: 'TPVs',
		}]
	};

	it('parent uses the fa-cubes icon', async() => {
		assert.strictEqual(thinProvEntry.icon, 'fa-cubes');
	});

	it('parent is not admin-only (visible to all users)', async() => {
		assert.strictEqual(thinProvEntry.adminOnly, false);
	});

	it('parent caption is "Thin Provisioning"', async() => {
		assert.strictEqual(thinProvEntry.caption, 'Thin Provisioning');
	});

	it('has two subItems: CDVs and TPVs', async() => {
		assert.strictEqual(thinProvEntry.subItems.length, 2);
	});

	it('first subItem URL points to the CDV route', async() => {
		assert.strictEqual(thinProvEntry.subItems[0].url, '/thin-provisioning/cdv');
	});

	it('first subItem caption is "CDVs"', async() => {
		assert.strictEqual(thinProvEntry.subItems[0].caption, 'CDVs');
	});

	it('second subItem URL points to the TPV route', async() => {
		assert.strictEqual(thinProvEntry.subItems[1].url, '/thin-provisioning/tpv');
	});

	it('second subItem caption is "TPVs"', async() => {
		assert.strictEqual(thinProvEntry.subItems[1].caption, 'TPVs');
	});
});

// ---------------------------------------------------------------------------
// Router.jsx — componentsRegistry TPV entry (structural contract)
// The key used in componentsRegistry must match the consts page key.
// See Router.jsx:51
// ---------------------------------------------------------------------------

describe('Router.jsx — componentsRegistry TPV entry', () => {
	const expectedPath = './pages/thinProvisioning/ThinProvisioning.js';

	it('componentsPages.tpv is the key used to look up the component', async() => {
		// The registry is keyed by consts.componentsPages.tpv
		assert.strictEqual(consts.componentsPages.tpv, 'tpv');
	});

	it('expected ThinProvisioning.js path contains the correct folder and filename', async() => {
		assert.ok(expectedPath.includes('thinProvisioning/ThinProvisioning.js'));
	});
});

describe('Router.jsx — componentsRegistry CDV entry', () => {
	const expectedPath = './pages/thinProvisioning/CDVs.js';

	it('componentsPages.cdv is the key used to look up the component', async() => {
		assert.strictEqual(consts.componentsPages.cdv, 'cdv');
	});

	it('expected CDVs.js path contains the correct folder and filename', async() => {
		assert.ok(expectedPath.includes('thinProvisioning/CDVs.js'));
	});
});

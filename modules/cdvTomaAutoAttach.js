/*
 * SPDX-FileCopyrightText: Copyright (c) 2026 NVIDIA CORPORATION & AFFILIATES. All rights reserved.
 * SPDX-License-Identifier: Apache-2.0
 */

/* global app */

const consts = require('../consts');
const logger = require('../logger');
const { MongoError } = require('./error');

// Manages the automatic attachment of CDV volumes to TOMA nodes that host
// RW-enabled disk segments of the CDV's first pRAID.  A TOMA node needs the CDV
// attached (non-hidden, SHARED_RW) so its allocator process can perform direct
// block I/O to the allocator area (first allocatorSizeGB of the CDV).
//
// Attachment lifetime is tracked via the `toma:<cdvUUID>` referenceID on the
// client attachment.  The CDV is detached from a node only when BOTH the
// toma:* and all tpv:* referenceIDs are gone (handled by detachVolumes ref logic).

class CDVTomaAutoAttach {
	// Lazy require to avoid circular dependency (client.js ↔ volume.js ↔ cdvTomaAutoAttach.js).
	_clientModule() {
		return require('./client');
	}

	// Returns node_id values of all RW-enabled disk segments in the CDV's first pRAID chunk.
	_firstPRaidNodeIds(cdv) {
		if (!cdv.chunks || !cdv.chunks[0]) return [];
		const firstChunk = cdv.chunks[0];
		return [...new Set(
			firstChunk.pRaids
				.flatMap(pRaid => pRaid.diskSegments)
				.filter(seg => seg.status === consts.diskSegmentStatuses.NORMAL)
				.map(seg => seg.node_id)
		)];
	}

	// Attaches the CDV to all first-pRAID TOMA nodes (potential allocators).
	// Idempotent: attachVolumes handles the case where the CDV is already attached
	// (adds the toma: referenceID without creating a duplicate attachment).
	// Called when the first TPV on a CDV is attached to any client, and on topology additions.
	async attachCDVToAllTomaNodes(cdv) {
		const nodeIds = this._firstPRaidNodeIds(cdv);
		await Promise.all(nodeIds.map(nodeId => this.attachCDVToNode(cdv, nodeId)));
	}

	// Called after a TPV is fully detached (exclusiveClient already cleared in DB).
	// If no other TPVs on this CDV remain actively attached, removes the toma: referenceID
	// from all first-pRAID nodes, allowing detachVolumes to send a full DetachVolumes message
	// when no other refs (tpv:*) are present.
	async onTPVDetached(cdv) {
		const db = app.get('db');
		const volumeCollection = db.collection('volume');

		const remainingCount = await volumeCollection.countDocuments({
			volumeClass: consts.volumeClass.TPV,
			'tpvConfig.cdvUUID': cdv.uuid,
			'tpvConfig.exclusiveClient': { $ne: null }
		});

		if (remainingCount > 0) {
			logger.sysDEBUG(`cdvTomaAutoAttach.onTPVDetached: CDV ${cdv._id} still has ${remainingCount} active TPV(s); keeping TOMA attachment`);
			return;
		}

		logger.sysDEBUG(`cdvTomaAutoAttach.onTPVDetached: last active TPV detached from CDV ${cdv._id}; removing TOMA attachments`);
		const nodeIds = this._firstPRaidNodeIds(cdv);
		await Promise.all(nodeIds.map(nodeId => this.maybeDetachCDVFromNode(cdv, nodeId)));
	}

	// Removes the toma: referenceID from all first-pRAID nodes. Used during CDV deletion
	// to clear any remaining TOMA attachments before the volume record is removed.
	async detachCDVFromAllNodes(cdv) {
		const nodeIds = this._firstPRaidNodeIds(cdv);
		await Promise.all(nodeIds.map(nodeId => this.maybeDetachCDVFromNode(cdv, nodeId)));
	}

	// Called when a TOMA topology update affects the first pRAID of a CDV.
	// addedNodeIds / removedNodeIds are node_id strings.
	async onTopologyUpdate(cdvUUID, addedNodeIds, removedNodeIds) {
		const db = app.get('db');
		const volumeCollection = db.collection('volume');

		const cdv = await volumeCollection.findOne({ uuid: cdvUUID, volumeClass: consts.volumeClass.CDV });
		if (!cdv) {
			logger.sysDEBUG(`cdvTomaAutoAttach.onTopologyUpdate: CDV ${cdvUUID} not found`);
			return;
		}

		await Promise.all([
			...addedNodeIds.map(nodeId => this.attachCDVToNode(cdv, nodeId)),
			...removedNodeIds.map(nodeId => this.maybeDetachCDVFromNode(cdv, nodeId))
		]);
	}

	// Attaches the CDV to the client running on nodeId.
	// Uses isHidden=false so the TOMA node gets a real R/W block device for allocator I/O.
	// referenceID = `toma:<cdvUUID>` — cleared by maybeDetachCDVFromNode.
	attachCDVToNode(cdv, nodeId) {
		return new Promise((resolve) => {
			const db = app.get('db');
			const clientCollection = db.collection('client');

			clientCollection.findOne({ _id: nodeId }, { projection: { uuid: 1 } }, (err, clientDoc) => {
				if (err) {
					new MongoError(err).log();
					return resolve();
				}
				if (!clientDoc) {
					logger.sysDEBUG(`cdvTomaAutoAttach.attachCDVToNode: no client record for nodeId ${nodeId}`);
					return resolve();
				}

				this._clientModule().attachVolumes(nodeId, clientDoc.uuid, [{
					uuid: cdv.uuid,
					name: cdv._id,
					referenceID: `toma:${cdv.uuid}`,
					reservation: { mode: consts.reservationModeNames.SHARED_READ_WRITE },
					isHidden: false
				}], () => resolve());
			});
		});
	}

	// Removes the toma:<cdvUUID> referenceID from the CDV attachment on nodeId.
	// detachVolumes sends an actual DetachVolumes message only when referenceIDs becomes empty
	// (i.e. no other tpv:* or toma:* refs remain), so this is safe to call unconditionally.
	maybeDetachCDVFromNode(cdv, nodeId) {
		return new Promise((resolve) => {
			const db = app.get('db');
			const clientCollection = db.collection('client');

			clientCollection.findOne({ _id: nodeId }, { projection: { uuid: 1 } }, (err, clientDoc) => {
				if (err) {
					new MongoError(err).log();
					return resolve();
				}
				if (!clientDoc) {
					return resolve();
				}

				this._clientModule().detachVolumes(nodeId, clientDoc.uuid, [{
					uuid: cdv.uuid,
					name: cdv._id,
					referenceID: `toma:${cdv.uuid}`
				}], () => resolve());
			});
		});
	}
}

module.exports = new CDVTomaAutoAttach();

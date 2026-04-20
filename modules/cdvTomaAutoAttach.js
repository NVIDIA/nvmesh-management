/*
 * SPDX-FileCopyrightText: Copyright (c) 2026 NVIDIA CORPORATION & AFFILIATES. All rights reserved.
 * SPDX-License-Identifier: Apache-2.0
 */

/* global app */

const consts = require('../consts');
const logger = require('../logger');
const { MongoError } = require('./error');

// Manages the automatic attachment of CDV volumes to TOMA nodes that host
// disk segments in the CDV's first pRAID.  A TOMA node needs the CDV attached
// (non-hidden, SHARED_RW) so its allocator process can perform direct block I/O
// to the allocator area (satellite volume sized allocatorSizeGib GiB).
//
// Two independent reasons can keep a CDV attached to a given node:
//   1. TOMA reason  — the node has a disk segment in the CDV's first pRAID
//      (tracked via `toma:<cdvUUID>` referenceID).
//   2. TPV reason   — a TPV on that client uses this CDV
//      (tracked via `tpv:<tpvUUID>` referenceID, managed by attachTPV/detachTPV).
//
// The CDV is detached from a node only when BOTH reference classes are empty
// (handled by detachVolumes ref logic).
//
// The `toma:` referenceID lifecycle is independent of TPV state:
//   - Added at CDV creation (all first-pRAID nodes) and on topology additions.
//   - Removed on topology removals or CDV deletion.
//   - NOT removed when TPVs detach — that only clears `tpv:` refs.

class CDVTomaAutoAttach {
	// Lazy require to avoid circular dependency (client.js ↔ volume.js ↔ cdvTomaAutoAttach.js).
	_clientModule() {
		return require('./client');
	}

	// Returns node_id values of all nodes that have any disk segment in the CDV's first pRAID chunk,
	// regardless of segment status.
	_firstPRaidNodeIds(cdv) {
		if (!cdv.chunks || !cdv.chunks[0]) return [];
		const firstChunk = cdv.chunks[0];
		return [...new Set(
			firstChunk.pRaids
				.flatMap(pRaid => pRaid.diskSegments)
				.map(seg => seg.node_id)
		)];
	}

	// Attaches the CDV to all first-pRAID TOMA nodes (potential allocators).
	// Idempotent: attachVolumes handles the case where the CDV is already attached
	// (adds the toma: referenceID without creating a duplicate attachment).
	// Called at CDV creation time and whenever nodes are added to the first pRAID.
	async attachCDVToAllTomaNodes(cdv) {
		const nodeIds = this._firstPRaidNodeIds(cdv);
		await Promise.all(nodeIds.map(nodeId => this.attachCDVToNode(cdv, nodeId)));
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

	// Queries all CDVs with allocated chunks and calls attachCDVToAllTomaNodes for each.
	// Run once at startup to recover from any missed creation-time attaches (e.g. management
	// restart, code update) without requiring manual intervention.
	async reconcileAllCDVs() {
		const db = app.get('db');
		const volumeCollection = db.collection('volume');

		logger.sysDEBUG('cdvTomaAutoAttach.reconcileAllCDVs: starting CDV TOMA attachment reconciliation');

		const cdvs = await volumeCollection.find(
			{ volumeClass: consts.volumeClass.CDV, chunks: { $exists: true, $not: { $size: 0 } } }
		).toArray();

		logger.sysDEBUG(`cdvTomaAutoAttach.reconcileAllCDVs: found ${cdvs.length} CDV(s) to reconcile`);

		await Promise.all(cdvs.map(cdv => this.attachCDVToAllTomaNodes(cdv)));

		logger.sysDEBUG('cdvTomaAutoAttach.reconcileAllCDVs: reconciliation complete');
	}

	// Computes the delta between previousNodeIds and the current first-pRAID node IDs on cdv,
	// then attaches newly-added nodes and detaches removed nodes.  Used after a pRAID segment
	// change to keep TOMA attachment in sync with the actual disk segment topology.
	async reconcileFirstPRaidAttachments(cdv, previousNodeIds) {
		const currentNodeIds = this._firstPRaidNodeIds(cdv);
		const prevSet = new Set(previousNodeIds);
		const currSet = new Set(currentNodeIds);
		const addedNodeIds = currentNodeIds.filter(id => !prevSet.has(id));
		const removedNodeIds = previousNodeIds.filter(id => !currSet.has(id));
		if (!addedNodeIds.length && !removedNodeIds.length) return;
		logger.sysDEBUG(`cdvTomaAutoAttach.reconcileFirstPRaidAttachments: CDV ${cdv._id} added=[${addedNodeIds}] removed=[${removedNodeIds}]`);
		await Promise.all([
			...addedNodeIds.map(nodeId => this.attachCDVToNode(cdv, nodeId)),
			...removedNodeIds.map(nodeId => this.maybeDetachCDVFromNode(cdv, nodeId))
		]);
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

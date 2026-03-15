/*
 * SPDX-FileCopyrightText: Copyright (c) 2026 NVIDIA CORPORATION & AFFILIATES. All rights reserved.
 * SPDX-License-Identifier: Apache-2.0
*/

// ========================================================
// Historical apidoc blocks should be inserted bellow.
// It will be used to generate the API documentation for the previous versions of the API.
// Please group the documentation blocks by the @apiGroup, then by @apiName for easier maintenance.
// ========================================================

// upgrades
// --------

/**
 * @apiVersion 17.0.0
 * @api {get} /upgrades/getPossibleUpgrades Get possible upgrades
 * @apiName GetPossibleUpgrades
 * @apiGroup upgrades
 * @apiDescription Get possible upgrades for a given source version.
 *
 * @apiQuery {string} sourceVersion The source version to get possible upgrades for.
 * @apiExample {string} Example request
 * /upgrades/getPossibleUpgrades?sourceVersion=3.2.0
 * @apiSuccess {string[]} versions List of possible upgrades.
 * @apiSuccessExample Example data on success
 * ["3.2.0-15", "3.2.1-16"]
 */

// Volumes
// --------

/**
* @apiVersion 17.0.0
* @api {post} /volumes/save Save volumes
* @apiName SaveVolumes
* @apiGroup volumes
* @apiDescription Create one or more volumes.
* At a minimum, `name` and `capacity` are required.
* You must also specify allocation rules, either by providing a `VPG` or by specifying `RAIDLevel` and other parameters.
*
* @apiBody {object[]} volumes `volumes` to create.
* @apiBody {string} volumes.name <strong>Required</strong>. Name of the `volume`. The name must be unique, as it will become the `ID` of the `volume`.
* @apiBody {object} volumes.capacity <strong>Required</strong>. Space to allocate for the `volume` in GB, or `'MAX'` for using all of the available space.
* @apiBody {string} [volumes.VPG] The VPG to use for allocation. If provided, `RAIDLevel` and other allocation-related properties must NOT be sent.
* @apiBody {string} [volumes.RAIDLevel] The RAID level of the `volume`. <strong>Required if `VPG` is not provided</strong>.<br />
* <small><i>Options: `Concatenated`, `Striped RAID-0`, `Mirrored RAID-1`, `Striped & Mirrored RAID-10`, `Erasure Coding`, `Striped Erasure Coding`</i></small>.
* @apiBody {string} [volumes.description] `Description` of the `volume`.
* @apiBody {integer} [volumes.relativeRebuildPriority=10] Sets the volume relative rebuild priority.
* @apiBody {string[]} [volumes.VSGs] Associated volume security groups.
* @apiBody {string} [volumes.sourceID] The Source Volume ID. Used for creating a snapshot. Requires `sourceUUID`.
* @apiBody {string} [volumes.sourceUUID] The Source Volume UUID. Used for creating a snapshot. Requires `sourceID`.
* @apiBody {object} [volumes.mdvSpec] The allocation specifications for the metadata volume, used for snapshots.
* @apiBody {string[]} [volumes.mdvSpec.diskClasses] Limit the metadata `volume` allocation to specific `diskClasses`.
* @apiBody {string[]} [volumes.mdvSpec.serverClasses] Limit the metadata `volume` allocation to specific `serverClasses`.
* @apiBody {string[]} [volumes.mdvSpec.limitByDisks] Limit the metadata `volume` allocation to specific `disks`.
* @apiBody {string[]} [volumes.mdvSpec.limitByNodes] Limit the metadata `volume` allocation to specific `nodes`.
* @apiBody {string} [volumes.mdvSpec.VPG] Limit the metadata `volume` allocation to a specific `VPG`.
* @apiBody {boolean} [volumes.allowAllocationOnOfflineDrives=false] Use offline drives for allocation.
* @apiBody {boolean} [volumes.isReadOnly=false] Should be true when creating a source volume for a snapshot.
* @apiBody {boolean} [volumes.enableNVMf=false] Enable NVMf exposure for the `volume`. If true, `selectedClientsForNvmf` is required.
* @apiBody {string[]} [volumes.selectedClientsForNvmf] Expose the `volume` as NVMf target for specific `clients`.
* <strong>Required if `enableNVMf` is true.</strong>
* @apiBody {boolean} [volumes.isEncrypted=false] Create an encrypted volume.
* @apiBody {object} [volumes.encryption] Encryption options. <strong>Available when `isEncrypted` is true.</strong>
* @apiBody {integer} [volumes.encryption.headerSize=16] Volume encryption header size in MiB.
* @apiBody {object} [volumes.metadata={}] An Object containing `volume`'s metadata. (Max size: 256KB)
* @apiBody {boolean} [volumes.use_debug_di=false] Use debug disk information for the `volume`. <br/><strong> Internal use only !</strong>
* @apiBody (Allocation) {string[]} [diskClasses] Limit `volume` allocation to specific `diskClasses`.
* <br/><strong>Not allowed if `VPG` is set.</strong>
* @apiBody (Allocation) {string[]} [limitByDisks] Limit `volume` allocation to specific `disks`. <br/><strong>Not allowed if `VPG` is set.</strong>
* @apiBody (Allocation) {string[]} [limitByNodes] Limit `volume` allocation to specific `nodes`. <br/><strong>Not allowed if `VPG` is set.</strong>
* @apiBody (Allocation) {string[]} [serverClasses] Limit volumes allocation to specific `serverClasses`.
* <br/><strong>Not allowed if `VPG` is set.</strong>
* @apiBody (Allocation) {string} [domain] `Domain` to use for allocation. <br/><strong>Not allowed if `VPG` is set.</strong>
* @apiBody (RAID) {integer} [stripeSize=32] Stripe size in 4k blocks (e.g., 32 for 128k).
* <br/><strong>Depends on `RAIDLevel`. Not allowed if `VPG` is set.</strong>
* @apiBody (RAID) {integer} [stripeWidth=2] Number of disks for stripe. <br/><strong>Depends on `RAIDLevel`. Not allowed if `VPG` is set.</strong>
* @apiBody (RAID) {integer} [numberOfMirrors=1] Number of mirrors. <br/><strong>Depends on `RAIDLevel`. Not allowed if `VPG` is set.</strong>
* @apiBody (RAID) {integer} [dataBlocks=8] Number of data disks for Erasure Coding. <br/><strong>Depends on `RAIDLevel`. Not allowed if `VPG` is set.</strong>
* @apiBody (RAID) {integer} [parityBlocks=2] Number of parity disks for Erasure Coding.
* <br/><strong>Depends on `RAIDLevel`. Not allowed if `VPG` is set.</strong>
* @apiBody (RAID) {string} [protectionLevel='Full Separation'] Protection level.
* <small><i>Options: `Full Separation`, `Minimal Separation`,
* `Ignore Separation`</i></small>
* <br/><strong>Depends on `RAIDLevel`. Not allowed if `VPG` is set.</strong>
* @apiBody (RAID) {boolean} [ignoreNodeSeparation=false] Disable node separation for mirrored volumes.
* <br/><strong>Depends on `RAIDLevel`. Not allowed if `VPG` is set.</strong>
* @apiBody (RAID) {boolean} [enableCrcCheck=false] Enable CRC check for the `volume`. Defaults to true for `Erasure Coding` and `Striped Erasure Coding`.
<br/><strong>Depends on `RAIDLevel`. Not allowed if `VPG` is set.</strong>
* @apiExample {string} Payload example
* [{
* 		"RAIDLevel": "Striped RAID-0",
*		"capacity": 100,
*		"description": "Plain text",
*		"diskClasses": ["highPerformance"],
* 		"limitByDisks": ["CVMD439000DE400FGN.1"],
*	 	"limitByNodes": ["nvme31.acme.com"],
*		"name": "V4",
*		"serverClasses": [],
*		"stripeSize": 32,
*		"stripeWidth": 2,
*		"domain": "Rack",
*		"VSGs": ["VSG1", "VSG2"]
* }]
* @apiSuccess {object} results success statuses
* @apiSuccessExample Example data on success
* [{
* 		"_id": "V4",
*   	"uuid": "f02abf10-6bfb-11ed-a62f-d1b4ca08eefb",
* 		"success": true,
*		"error": null
* }]
*/

// VPGs
// --------

/**
* @apiVersion 17.0.0
* @api {post} /volumeProvisioningGroups/save Create VPGs
* @apiName CreateVPGs
* @apiGroup VPGs
* @apiDescription Create `VPGs`.
*
* @apiBody {object[]} VPGs `VPGs` to save.
* @apiBody {string} VPGs.name <strong>Required</strong>. Name of the `VPG`.
* @apiBody {string} VPGs.RAIDLevel <strong>Required</strong>. The RAID level for volumes in this VPG.<br />
* <small><i>Options: `Concatenated`, `Striped RAID-0`, `Mirrored RAID-1`, `Striped & Mirrored RAID-10`, `Erasure Coding`, `Striped Erasure Coding`.</i></small>
* @apiBody {string} [VPGs.capacity=0] Space to reserve for the VPG in GB.
* @apiBody {string} [VPGs.description] `Description` of the `VPG`.
* @apiBody {string[]} [VPGs.diskClasses] Limit volumes allocation to specific `diskClasses`.
* @apiBody {string[]} [VPGs.serverClasses] Limit volumes allocation to specific `serverClasses`.
* @apiBody {string[]} [VPGs.VSGs] Associated volume security groups.
* @apiBody {boolean} [VPGs.allowOverflow=true] Allow allocation outside of reserved space.
* @apiBody {boolean} [VPGs.allowAllocationOnOfflineDrives=false] Use offline drives for allocation.
* @apiBody {string} [VPGs.type] `type` of the VPG. Set to `METADATA_VOLUME` if the VPG is for a snapshot's metadata volume.
This will force `RAIDLevel` to `Mirrored RAID-1`.
* @apiBody {boolean} [VPGs.isEncrypted=false] Volumes in this VPG will be encrypted.
* @apiBody {object} [VPGs.encryption] Encryption options. <strong>Available when `isEncrypted` is true.</strong>
* @apiBody {integer} [VPGs.encryption.headerSize=16] Volume encryption header size in MiB.
* @apiBody {string} [VPGs.domain] `Protection Domain` to use for allocation.
* @apiBody (RAID) {integer} [stripeSize=32] Stripe size in 4k blocks (e.g., 32 for 128k). <br/><strong>Depends on `RAIDLevel`.</strong>
* @apiBody (RAID) {integer} [stripeWidth=2] Number of disks for stripe. <br/><strong>Depends on `RAIDLevel`.</strong>
* @apiBody (RAID) {integer} [numberOfMirrors=1] Number of mirrors. <br/><strong>Depends on `RAIDLevel`.</strong>
* @apiBody (RAID) {integer} [dataBlocks=8] Number of data disks for Erasure Coding. <br/><strong>Depends on `RAIDLevel`.</strong>
* @apiBody (RAID) {integer} [parityBlocks=2] Number of parity disks for Erasure Coding. <br/><strong>Depends on `RAIDLevel`.</strong>
* @apiBody (RAID) {string} [protectionLevel='Full Separation'] Protection level. <small><i>Options: `Full Separation`, `Minimal Separation`,
`Ignore Separation`.</i></small> <br/><strong>Depends on `RAIDLevel`.</strong>
* @apiBody (RAID) {boolean} [ignoreNodeSeparation=false] Disable node separation for mirrored volumes. <br/><strong>Depends on `RAIDLevel`.</strong>
* @apiBody (RAID) {boolean} [enableCrcCheck=false] `enableCrcCheck` Enables CRC check for the derived volumes.
Defaults to true for Erasure Coding and Striped Erasure Coding.
* @apiExample {object[]} Payload example
* [{
* 	"RAIDLevel": "Striped RAID-0",
*	"capacity": 100,
*	"description": "Plain text",
*	"diskClasses": null,
*	"name": "VPG1",
*	"serverClasses": ["V1"],
*	"VSGs": ["VSG1"],
*	"allowOverflow": true,
*	"domain": "Rack",
*	"stripeSize": 32,
*	"stripeWidth": 2,
*	"enableCrcCheck": false
* }]
* @apiSuccess {object} results success statuses
* @apiSuccessExample Example data on success
* [{
*	"_id": "highEndurance",
*	"uuid": "05457a00-7a13-11ed-a3a5-2dd1199d2398"
*	"success": true,
*	"error": null
* }]
*/

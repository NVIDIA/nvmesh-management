/*
 * SPDX-FileCopyrightText: Copyright (c) 2026 NVIDIA CORPORATION & AFFILIATES. All rights reserved.
 * SPDX-License-Identifier: Apache-2.0
 */

/* global db */

db.client.deleteMany({});
db.server.deleteMany({});
db.volume.deleteMany({});
db.diskClass.deleteMany({});
db.serverClass.deleteMany({});
db.volumeProvisioningGroup.deleteMany({});
db.log.deleteMany({});
db.managementCluster.deleteMany({});
db.configurationVersion.deleteMany({});
db.lastMessageLog.deleteMany({});
db.configurationProfile.deleteMany({});
db.nodeConfiguration.deleteMany({});
db.mcsConnection.deleteMany({});

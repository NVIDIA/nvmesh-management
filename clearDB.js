/***************************************************************************
 * Copyright (C) 2015-2020 Excelero, Inc. All Rights Reserved.
 *
 * This file is part of Excelero NVMesh software.
 *
 * Unauthorized copying of this file, via any medium is strictly prohibited
 * Proprietary and confidential
 ****************************************************************************/

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

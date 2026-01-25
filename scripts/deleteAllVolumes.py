# SPDX-FileCopyrightText: Copyright (c) 2026 NVIDIA CORPORATION & AFFILIATES. All rights reserved.
# SPDX-License-Identifier: Apache-2.0

import json

from NVMeshSDK.Entities.Volume import Volume
from NVMeshSDK.APIs.VolumeAPI import VolumeAPI
from NVMeshSDK.MongoObj import MongoObj

volumeAPI = VolumeAPI()

myProj = [MongoObj(field=Volume.Id, value=1), MongoObj(field=Volume.Size, value=1), MongoObj(field=Volume.RaidLevel, value=1)]
err, out = volumeAPI.get(projection=myProj)

#print (out)

err, res = volumeAPI.delete(out)

print (res)



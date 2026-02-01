#!/usr/bin/python2

# SPDX-FileCopyrightText: Copyright (c) 2026 NVIDIA CORPORATION & AFFILIATES. All rights reserved.
# SPDX-License-Identifier: Apache-2.0

from infraClient.common.ManagementClient import ManagementClient

mClient = ManagementClient('/etc/nvmesh/nvmesh.conf')

volume = {
	'capacity': '1G',
	'RAIDLevel': 'LVM/JBOD'
}

for x in xrange(20):
	volume['volume'] = 'j2_{0}'.format(x)
	mClient.createVolume(volume)


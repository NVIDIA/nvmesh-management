#!/usr/bin/python2

from infraClient.common.ManagementClient import ManagementClient

mClient = ManagementClient('/etc/nvmesh/nvmesh.conf')

volume = {
	'capacity': '1G',
	'RAIDLevel': 'LVM/JBOD'
}

for x in xrange(20):
	volume['volume'] = 'j2_{0}'.format(x)
	mClient.createVolume(volume)


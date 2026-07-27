import time
import datetime

from NVMeshSDK.Entities.Volume import Volume
from NVMeshSDK.APIs.VolumeAPI import VolumeAPI
from NVMeshSDK.MongoObj import MongoObj

SIM_VOLUMES = 50

volumes = []
startIndex = 1

def getPendingVolumes():
	mongoFilter = [MongoObj(field=Volume.Status, value={"$ne": "online"})]
	err, out = volumeAPI.get(filter=mongoFilter)

	return len(out)

while True:
	print "Starting Index: {}".format(startIndex)
	for x in xrange(startIndex, SIM_VOLUMES + startIndex):
		print "Creating volume: {}".format(x)
		volume = Volume(name="vol_{}".format(x), RAIDLevel="Mirrored RAID-1", capacity=1024**3, numberOfMirrors=1)
		volumes.append(volume)

	volumeAPI = VolumeAPI()
	print "Issuing save command"
	start = datetime.datetime.now()
	err, out = volumeAPI.save(volumes)
	end = datetime.datetime.now()
	print "Finished in {} seconds".format((end - start).total_seconds())

	volumes = []


	startIndex += SIM_VOLUMES

	pending = getPendingVolumes()
	print ('We have {} pending volumes'.format(pending))

	while (float(pending) / SIM_VOLUMES) > 1.0:
		print('The\'re pending volumes, sleeping 2 seconds. pending: {}'.format(pending))
		time.sleep(2)

		pending = getPendingVolumes()

import os
import re
import datetime
import json

from pymongo import MongoClient

def parseSection(section):
	result = {}

	rows = section.split('\n')

	result[rows[0]] = []
	headers = []

	if (rows[0] == 'MGMT_CONFIG_VERSION'):
		headers = rows[1].split(',')
	else:
		headers = re.findall('"[^"]*"', rows[1])

	for row in rows[2:len(rows)-1]:
		obj = {}

		for index, cell in enumerate(row.split(',')):
			obj[headers[index].strip('"')] = cell

		result[rows[0]].append(obj)

	return result

def convertTOMAConfigToJSON():
	jsonObj = {}

	with open('/home/tomzan/projects/management/scripts/toma_config.csv_bufs') as bufFile:
		content = bufFile.read()

	result = re.split('SECTION NAME: ', content)

	for section in result[1:]:
		jsonObj.update(parseSection(section))

	return jsonObj

def createConfigurationVersionDocs(conf):
	zone = { '_id': '1' }
	zone['configurationVersion'] = int(conf['MGMT_CONFIG_VERSION'][0]['mgmt_config_version'])

	cluster = { '_id': 'CLUSTER', 'protocolVersion': 1 }
	cluster['dbUUID'] = conf['MGMT_CONFIG_VERSION'][0]['mgmt_DB_uuid']
	cluster['supportedMCSVersions'] = ['1.0']

	return zone, cluster

def reconstructVolumes(conf):
	volumes = []

	for confVol in conf['BLOCK_DEVICES_V1_4']:
		volume = {
			'_id': confVol['name'],
			'name': confVol['name'],
			'uuid': confVol['uuid'],
			'version': int(confVol['version']),
			'limitByNodes': [],
			'limitByNodes': [],
			'serverClasses': [],
			'serverClasses': [],
			'enableNVMf': False,
			'selectedClientsForNvmf': [],
			'isReserved': False,
			'status': 'online',
			'action': 'none',
			'health': 'healthy',
			'type': 'normal',
			'enableCrcCheck': False,
			'reservation': {
				'mode' : 0,
				'version' : 1,
				'reservedBy' : None
			},
			'lockServer': {
				'maxNOwners': 2,
				'type': 2,
				'locksetShift': -1
			}
		}

		volume['relativeRebuildPriority'] = int(confVol['attr_relative_rebuild_priority'])
		volume['capacity'] = round(int(confVol['size (blks)']) * int(confVol['blk_size (bytes)'] / pow(1000, 3)), 2)
		volume['blockSize'] = int(confVol['blk_size (bytes)'])
		volume['blocks'] = int(confVol['size (blks)'])

		reconstructVolumeChunks(conf, volume)

		volumes.append(volume)

	return volumes

def reconstructVolumeChunks(conf, volume):
	chunks = []

	for confChunk in [ chunk for chunk in conf['CHUNKS'] if chunk['block_device_uuid'] == volume['uuid'] ]:
		chunk = {
			'_id': confChunk['uuid'],
			'uuid': confChunk['uuid'],
			'vlbs': int(confChunk['vlb_s']),
			'vlbe': int(confChunk['vlb_e'])
		}

		volume['stripeSize'] = int(confChunk['stripe_size (4K)'])
		volume['stripeWidth'] = int(confChunk['stripe_width'])

		reconstructChunkPRaids(conf, chunk, volume)

		chunks.append(chunk)

	volume['chunks'] = chunks

def reconstructChunkPRaids(conf, chunk, volume):
	pRaids = []

	for confPraid in [ pRaid for pRaid in conf['PRAIDS_1'] if pRaid['chunk_uuid'] == chunk['uuid'] ]:
		pRaid = {
			'uuid': confPraid['uuid'],
			'zone': '1',
			'activated': bool(confPraid['was_ever_activated']),
			'version': {
				'major': 0,
				'minor': 0
			},
			'tomaLeaderRaftTerm': 0,
			'lastReport': datetime.datetime.now().strftime('%Y-%m-%dT%H:%M:%S.%f'),
			'stripeIndex': int(confPraid['stripe_idx'])
		}

		reconstructPRaidSegments(conf, pRaid, volume)

		pRaids.append(pRaid)

		volume['numberOfMirrors'] = int(confPraid['redundancy'])
		volume['RAIDLevel'] = 'Mirrored RAID-1' if confPraid['type (JB,R1,R5,R6,5DP)'] == 'R1' and not volume['stripeWidth'] else 'Striped & Mirrored RAID-10'

	chunk['pRaids'] = pRaids

def reconstructPRaidSegments(conf, pRaid, volume):
	segments = []

	NUMBER_OF_SEGMENTS_IN_PRAID = 3

	for confSegment in [ segment for segment in conf['DISK_SEGMENTS'] if segment['praid_uuid'] == pRaid['uuid'] ]:
		segment = {
			'_id': confSegment['uuid'],
			'uuid': confSegment['uuid'],
			'status': 'normal',
			'lbs': int(confSegment['lb_s (4K)']),
			'lbe': int(confSegment['lb_e (4K)']),
			'zone': '1',
			'type': 'data',
			'pRaidTypeIndex': int(confSegment['idx_in_praid_role']),
			'pRaidIndex': int(confSegment['idx_in_praid']),
			'diskUUID': confSegment['disk_uuid'],
			'pRaidUUID': pRaid['uuid'],
			'volumeUUID': volume['uuid'],
			'volumeName': volume['name'],
			'allocationIndex': pRaid['stripeIndex'] * NUMBER_OF_SEGMENTS_IN_PRAID + int(confSegment['idx_in_praid']),
			'extensionVolumeId': volume['name']
		}

		getDiskAndNodeInfoByUUID(conf, confSegment['disk_uuid'], segment)

		segments.append(segment)

	pRaid['diskSegments'] = segments

def getDiskAndNodeInfoByUUID(conf, UUID, segment):
	info = {}

	for confDisk in [ disk for disk in conf['DISKS'] if disk['uuid'] == UUID ]:
		info = {
			'diskID': confDisk['name'],
			'nodeUUID': confDisk['node_uuid']
		}

		getNodeIDByUUID(conf, confDisk['node_uuid'], info)

		break

	segment.update(info)

def getNodeIDByUUID(conf, UUID, info):
	for confNode in [ node for node in conf['NODES'] if node['uuid'] == UUID ]:
		info['node_id'] = confNode['node_name']

def reconstructTargets(conf, targets, volumes):
	for target in targets:
		for confTarget in conf['NODES']:
			if confTarget['node_name'] == target['node_id']:
				target['uuid'] = confTarget['uuid']
				target['messageSequence'] = 0

		reconstructNICs(conf, target)
		reconstructDrives(conf, target, volumes)

def reconstructNICs(conf, target):
	for confNIC in [ nic for nic in conf['NICS'] if nic['node_uuid'] == target['uuid'] ]:
		for nic in target['nics']:
			if nic['nicID'] == confNIC['guid']:
				nic['uuid'] = confNIC['uuid']
				nic['nodeUUID'] = target['uuid']

def reconstructDrives(conf, target, volumes):
	for confDrive in [ drive for drive in conf['DISKS'] if drive['node_uuid'] == target['uuid'] ]:
		for drive in target['disks']:
			if drive['diskID'] == confDrive['name']:
				drive['uuid'] = confDrive['uuid']
				drive['version'] = int(confDrive['version'])
				drive['nodeUUID'] = target['uuid']
				drive['isOutOfService'] = bool(int(confDrive['is_out_of_service']))
				drive['automaticallyEvicted'] = False
				drive['autoEvictReason'] = ''

				addSegmentsToDrive(drive, volumes)

def addSegmentsToDrive(drive, volumes):
	segments = []

	for volume in volumes:
		for chunk in volume['chunks']:
			for pRaid in chunk['pRaids']:
				for segment in pRaid['diskSegments']:
					if segment['diskUUID'] == drive['uuid']:
						segments.append(segment)

	drive['diskSegments'] = segments

	setLargestSegment(drive)

def setLargestSegment(disk):
	#If there's no GPT it means that it's safe to assume that the drive wasn't initialized, hence no segments on it.
	if 'GPT' not in disk:
		return

	minValSegment = disk['GPT']['firstUsableLba']
	maxValSegment = disk['GPT']['lastUsableLba'] + 1

	segment = getLargestRangeAndTotalAvailableSpace(disk, 'lbs', 'lbe', minValSegment, maxValSegment)

	result = {
		'lbs': segment['start'],
		'lbe': segment['end'],
		'blocks': segment['end'] - segment['start'] + 1
	}

	#Will happen only when the disk segments take exactly all the space.
	if result['lbe'] <= result['lbs']:
		result['lbe'] = 0
		result['lbs'] = 0

	disk['availableBlocks'] = segment['totalAvailableSpace']
	disk['largestSegmentAvailable'] = result

def getLargestRangeAndTotalAvailableSpace(disk, segmentStart, segmentEnd, startRange, endRange):
	minVal = startRange
	maxVal = 0
	totalAvailableSpace = 0
	lbs = -1
	lbe = -1

	if disk['diskSegments'] and len(disk['diskSegments']):
		for i, diskSegment in enumerate(sorted(disk['diskSegments'], key=lambda e: e[segmentStart])):
			blocksFromLeft = diskSegment[segmentStart] - minVal

			if blocksFromLeft > maxVal:
				maxVal = blocksFromLeft
				lbs = minVal
				lbe = diskSegment[segmentStart] - 1

			#add the available gap to the total available space
			if blocksFromLeft > 0:
				totalAvailableSpace = totalAvailableSpace + blocksFromLeft

			if diskSegment[segmentEnd] + 1 > minVal:
				minVal = diskSegment[segmentEnd] + 1

			#check the end edge.
			if len(disk['diskSegments']) - 1 == i:
				blocksInTheEnd = endRange - minVal

				if blocksInTheEnd >= maxVal:
					maxVal = blocksInTheEnd
					lbs = minVal
					lbe = lbs + blocksInTheEnd - 1

				if blocksInTheEnd > 0:
					totalAvailableSpace = totalAvailableSpace + blocksInTheEnd
	#No segments are allocated, just take all the space.
	else:
		lbs = minVal
		lbe = endRange - 1
		totalAvailableSpace = endRange - minVal

	return {
		'start': lbs,
		'end': lbe,
		'totalAvailableSpace': totalAvailableSpace
	}

confObj = convertTOMAConfigToJSON()

zoneDoc, clusterDoc = createConfigurationVersionDocs(confObj)
volumes = reconstructVolumes(confObj)

client = MongoClient()
db = client.management

volumeCollection = db.volume
volumeCollection.delete_many({})
volumeCollection.insert_many(volumes)

serverCollection = db.server
targets = list(serverCollection.find({}))

#Create a backups
serverBUCollection = db.serverBU
serverBUCollection.delete_many({})
serverBUCollection.insert_many(targets)
configurationVersionBUCollection = db.configurationVersionBU
configurationVersionBUCollection.insert_many(list(db.configurationVersion.find({})))

reconstructTargets(confObj, targets, volumes)

serverCollection.delete_many({})
serverCollection.insert_many(targets)

db.configurationVersion.delete_many({})
db.configurationVersion.insert_many([zoneDoc, clusterDoc])
from entities.BaseEntity import BaseEntity
from entities.Drive import Drive
from consts import DISK_STATUS

class DriveClass(BaseEntity):
	endpoint = 'diskClasses'
	CANT_FIND_IDENTITY_SYSTEM_MESSAGE_ID = 162521

	@classmethod
	def generate(cls, id):
		drive_class_entries = cls.get_n_drive_class_entries(1)
		return DriveClass(_id=id, disks=drive_class_entries)

	@classmethod
	def get_n_drive_class_entries(cls, n, exclude_disk_ids=None):
		exclude_disk_ids = [] if exclude_disk_ids is None else exclude_disk_ids

		query = {'disks.status': DISK_STATUS.OK}

		if exclude_disk_ids:
			query['disks.diskID'] = { '$not': { '$in': exclude_disk_ids } }

		projection = {'node_id': 1, 'disks.status': 1, 'disks.diskID': 1, 'disks.nodeID': 1, 'disks.Model': 1}

		drives = Drive.get(0, n, query, {}, projection)

		if n != len(drives):
			found_ids = [drive.get('diskID') for drive in drives]
			raise RuntimeError(f"Failed to find {n} eligible drives for drive class entry. Found {len(drives)}. Excluded: {exclude_disk_ids}. Found IDs: {found_ids}")

		return [{
			'diskID': drive.get('diskID'),
			'node_id': drive.get('nodeID'),
			'model': drive.get('Model')
		} for drive in drives]

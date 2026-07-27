from entities.BaseEntity import BaseEntity
from consts import REST_OP

class Target(BaseEntity):
	endpoint = 'servers'

	@classmethod
	def generate(cls, id):
		raise NotImplementedError()

	def save(self):
		raise NotImplementedError()

	@classmethod
	def save_many(cls, entities):
		raise NotImplementedError()

	def update(self):
		raise NotImplementedError()

	@classmethod
	def update_many(cls, entities):
		raise NotImplementedError()

	def evict(self):
		return self.post(REST_OP.EVICT, [self])

	@classmethod
	def evict_many(cls, entities):
		return cls.post(REST_OP.EVICT, entities)

	def delete_nic(self, nic):
		return self.post(REST_OP.DELETE_NIC, [nic])

	@classmethod
	def delete_nic_many(cls, nics):
		return cls.post(REST_OP.DELETE_NIC, nics)

	def set_zone(self, zone_id):
		payload = { 'zoneID': zone_id, 'targets': [self] }
		return self.post(REST_OP.SET_ZONE, payload)

	@classmethod
	def set_zone_many(cls, zone_id, targets):
		payload = { 'zoneID': zone_id, 'targets': targets }
		return cls.post(REST_OP.SET_ZONE, payload)

	def regenerate_toma_messages(self, zone_id):
		payload = { 'zoneID': zone_id }
		return self.post(REST_OP.REGENERATE_TOMA_MESSAGES, payload)

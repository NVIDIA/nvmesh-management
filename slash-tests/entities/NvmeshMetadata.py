from entities.BaseEntity import BaseEntity
from entities.BaseEntity import REST_OP
from utils.decorators import requires_management

class NvmeshMetadata(BaseEntity):
	endpoint = 'nvmeshMetadata'
	CANT_FIND_IDENTITY_SYSTEM_MESSAGE_ID = -1	# Not implemented

	@classmethod
	def generate(cls, id):
		raise NotImplementedError()

	@classmethod
	def fetch_entity(cls, id):
		raise NotImplementedError()

	@classmethod
	def count(cls):
		raise NotImplementedError()

	@classmethod
	def get_all(cls):
		raise NotImplementedError()

	@classmethod
	def get_by_id(cls, id):
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

	def delete(self):
		raise NotImplementedError()

	@classmethod
	def delete_many(cls, entities):
		raise NotImplementedError()

	@classmethod
	@requires_management
	def make_post(cls, route, payload):
		return [super().make_post(route, payload)]

	@classmethod
	def prepare_post_payload(cls, entity):
		return entity.to_dict()

	@classmethod
	def cluster_id(cls):
		return cls.make_get(REST_OP.CLUSTER_ID)

	def update_cluster_id(self):
		return self.post(REST_OP.UPDATE_CLUSTER_ID, self)

	@classmethod
	def get_cluster(cls):
		return cls(**cls.cluster_id())



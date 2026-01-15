from entities.BaseEntity import BaseEntity
from entities.Target import Target

class TargetClass(BaseEntity):
	endpoint = 'serverClasses'
	CANT_FIND_IDENTITY_SYSTEM_MESSAGE_ID = 327

	@classmethod
	def generate(cls, id):
		target_nodes = [target.get('_id') for target in Target.get(0, 1, {}, {}, {'_id': 1})]
		return TargetClass(name=id, targetNodes=target_nodes)


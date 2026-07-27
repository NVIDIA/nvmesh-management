from entities.BaseEntity import BaseEntity

class Key(BaseEntity):
	endpoint = 'keys'

	@classmethod
	def generate(cls, id):
		return Key(_id=id)

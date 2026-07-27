import json
from abc import ABC, abstractmethod

from utils.decorators import requires_management, requires_class_attributes
from utils.validations import validate_response_structure, validate_response_success
from consts import REST_OP

class BaseEntityError(Exception):
	'''Custom exception for BaseEntity operations.'''
	pass

@requires_class_attributes('endpoint')
class BaseEntity(ABC):
	endpoint = None		# Each subclass must define this
	management = None	# Placeholder for management client

	@staticmethod
	def get_defaults():
		'''
		Returns a dictionary of default attribute values for an instance.
		Subclasses should override this method to define their own default values.

		Returns:
			dict: A dictionary of default attribute values.
		'''
		return {}

	def __init__(self, *args, **kwargs):
		'''Initializes the instance with provided arguments while ensuring default values are assigned for missing attributes.'''
		defaults = self.get_defaults()

		# Merge defaults with provided arguments, prioritizing kwargs values
		merged_values = {**defaults, **kwargs}

		for key, value in merged_values.items():
			setattr(self, key, value)

	@classmethod
	@abstractmethod
	def generate(cls, id):
		'''
		Factory method that generates and returns an instance of BaseEntity with auto-generated values.

		This method encapsulates the basic logic for creating a new BaseEntity instance.
		It is intended to be overridden in subclasses to implement more specific instance generation logic if needed.

		Returns:
			BaseEntity: A newly generated sub-instance of BaseEntity with default settings.'''
		pass

	@property
	def identifier(self):
		if hasattr(self, 'name'):
			return self.name
		elif hasattr(self, '_id'):
			return self._id
		else:
			raise BaseEntityError(f"Can't determine identifier for entity {self}")

	@classmethod
	def fetch_entity(cls, id):
		'''
		Fetches an entity by its ID and returns an instance of the class.

		Args:
			id (str): The unique identifier of the entity to fetch.

		Returns:
			BaseEntity: An instance of the class populated with the fetched entity's data.

		Raises:
			BaseEntityError: If there is an error fetching the entity.
		'''
		response = cls.get_by_id(id)

		if 'error' in response:
			raise BaseEntityError(f"Failed to get entity by ID.", response)

		return cls(**response)

	@classmethod
	def set_management_client(cls, management):
		'''Initializes the management client on the BaseEntity class so any subclass will be able to use it'''
		cls.management = management

	@classmethod
	def _get_full_route(cls, route):
		return f"/{cls.endpoint}/{route}"

	def to_dict(self):
		'''Returns a dictionary representation of the entity'''
		return {k: v for k, v in self.__dict__.items() if not (k.startswith('_') and k != '_id')}

	def __str__(self):
		return json.dumps(self.to_dict(), sort_keys=True, indent=4)

	@classmethod
	def prepare_post_payload(cls, entities):
		'''Subclasses may overwrite this method if payload format is different (i.e. Dict instead of List of Dict)'''
		return [entity.to_dict() for entity in entities]

	@classmethod
	@requires_management
	def make_get(cls, route):
		route = cls._get_full_route(route)

		try:
			error, responses = cls.management.connection.get(route)

			if error:
				raise BaseEntityError(f"GET {route} failed: {error}")

			return responses

		except Exception as e:
			raise BaseEntityError(f"Unexpected error during GET {route}: {e}")

	@classmethod
	@requires_management
	def make_post(cls, route, payload):
		route = cls._get_full_route(route)

		try:
			error, responses = cls.management.connection.post(route, payload)

			if error:
				raise BaseEntityError(f"POST {route} failed: {error}")

			if not responses:
				raise BaseEntityError(f"No API responses after POST {route} with payload {payload}")

			return responses

		except Exception as e:
			raise BaseEntityError(f"Unexpected error during POST {route}: {e}")

	@staticmethod
	def _build_query_string(query_params):
		query = '?'
		is_first_param = True

		for param_name, param_value in query_params.items():
			if param_value is not None:
				prefix = '' if is_first_param else '&'
				query += f"{prefix}{param_name}={json.dumps(param_value)}"
				is_first_param = False

		if len(query) == 1:
			query = ''

		return query

	@classmethod
	def get(cls, page=0, count=0, filter=None, sort=None, projection=None):
		route = f"{REST_OP.ALL}/{page}/{count}"
		query = cls._build_query_string({'filter': filter, 'sort': sort, 'projection': projection})

		if query:
			route = f"{route}{query}"

		return cls.make_get(route)

	@classmethod
	def count(cls):
		return cls.make_get(REST_OP.COUNT)

	@classmethod
	def get_all(cls):
		return cls.get()

	@classmethod
	def get_by_id(cls, id):
		return cls.make_get(id)

	@classmethod
	def post(cls, route, entities):
		payload = cls.prepare_post_payload(entities)
		responses = cls.make_post(route, payload)

		for response in responses:
			validate_response_structure(response)
			validate_response_success(response)

		return responses

	def save(self):
		return self.post(REST_OP.SAVE, [self])

	@classmethod
	def save_many(cls, entities):
		return cls.post(REST_OP.SAVE, entities)

	def update(self):
		return self.post(REST_OP.UPDATE, [self])

	@classmethod
	def update_many(cls, entities):
		return cls.post(REST_OP.UPDATE, entities)

	def delete(self):
		return self.post(REST_OP.DELETE, [self])

	@classmethod
	def delete_many(cls, entities):
		return cls.post(REST_OP.DELETE, entities)

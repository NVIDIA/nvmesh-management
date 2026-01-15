
import slash
from functools import partial

from xlro.infra.fixtures import *

from entities.BaseEntity import BaseEntity, BaseEntityError
from utils.validations import ValidationError, validate_attributes, validate_response_uuid
from utils.decorators import requires_class_attributes


@requires_class_attributes('entity_id_prefix', entity_class=BaseEntity)
class BaseTester(slash.core.test.Test):
	_is_setup_called = False

	# Each subclass must define these
	entity_class = BaseEntity
	entity_id_prefix = ''

	many_entities_test_count = 10
	many_entities_test_delete_count = 5

	def setup(self, manager, simulator):
		'''Setup that should run before any tests in a tester'''
		BaseEntity.set_management_client(manager)
		slash.context.existing_common_tests_identifiers = {}

	def before(self):
		'''Overwrite of slash before method - should run before every test in the tester'''
		if not self.__class__._is_setup_called:
				with slash.session.cleanups.default_scope_override('module'):
					_call_with_fixtures = partial(self._fixture_store.call_with_fixtures, namespace=self._fixture_namespace)
					_call_with_fixtures(self.setup)
					self.__class__._is_setup_called = True

		if not self.entity_class in slash.context.existing_common_tests_identifiers:
			slash.context.existing_common_tests_identifiers[self.entity_class] = set()

	@classmethod
	def save_single_entity_with_validations(cls,  id='', entity=None):
		'''
		Saves a single entity and validates its persisted state.

		This method first creates (or utilizes an existing) entity and saves it by calling `save_entities()`.
		Then, it retrieves the saved entity performs validations to ensure:
		- The response's UUID matches the fetched entity.
		- The attributes of the originally saved entity and the fetched entity are consistent.

		Args:
			id (str, optional): Identifier to be used for generating the entity.
			entity (BaseEntity, optional): An instance of the entity to be saved.

		Raises:
			ValidationError: If the UUID in the response does not match or if the entity attributes fail validation.
		'''
		ids = [id] if id != '' else []
		entities = [entity] if entity is not None else []

		[entity], [response] = cls.save_entities(ids, entities)
		fetched_entity = cls.entity_class.fetch_entity(entity.identifier)

		validate_response_uuid(response, fetched_entity)
		validate_attributes(entity, fetched_entity)

	@classmethod
	def save_entities(cls, ids=None, entities=None):
		'''
		Creates and saves entity instances.

		If identifiers are provided, entities are generated using `entity_class.generate()`; otherwise, provided entity instances are used.
		The method then saves all entities via `save_many()`.

		Args:
			ids (list, optional): List of identifiers for generating entities.
			entities (list, optional): List of entity instances to be saved.

		Returns:
			tuple: A tuple containing the list of saved entity instances and their corresponding responses.
		'''
		ids = [] if ids is None else ids
		entities = [] if entities is None else entities

		entities = [cls.entity_class.generate(id) for id in ids] if ids else entities
		responses = cls.entity_class.save_many(entities)
		return entities, responses

	@classmethod
	def update_single_entity_with_validations(cls,  id='', entity=None, to_update={}):
		'''
		Updates a single entity and validates its persisted state.

		This method updates the entity by calling `update_entities()`, then fetches the updated entity and ensures:
		- The response UUID matches the fetched entity.
		- The attributes of the updated entity match the expected values.

		Args:
			id (str, optional): Identifier of the entity to be updated.
			entity (BaseEntity, optional): An existing entity instance to be updated.
			to_update (dict, optional): Dictionary of attributes and their new values.

		Raises:
			ValidationError: If the response UUID or updated attributes do not match expectations.
		'''
		ids = [id] if id != '' else []
		entities = [entity] if entity is not None else []

		[entity], [response] = cls.update_entities(ids, entities, to_update)
		fetched_entity = cls.entity_class.fetch_entity(entity.identifier)

		validate_response_uuid(response, fetched_entity)
		validate_attributes(entity, fetched_entity)

	@classmethod
	def update_entities(cls, ids=None, entities=None, to_update=None):
		'''
		Updates entities with specified attributes.

		If identifiers are provided, the entities are fetched first; otherwise, existing entity instances are used.
		The method updates the attributes of all entities and saves the changes.

		Args:
			ids (list, optional): List of entity identifiers to be updated.
			entities (list, optional): List of existing entity instances to be updated.
			to_update (dict, optional): Dictionary of attributes and their new values.

		Returns:
			tuple: A tuple containing the list of updated entity instances and their corresponding update responses.
		'''
		ids = [] if ids is None else ids
		entities = [] if entities is None else entities
		to_update = {} if to_update is None else to_update

		entities = [cls.entity_class.fetch_entity(id) for id in ids] if ids else entities

		for entity in entities:
			for k, v in to_update.items():
				setattr(entity, k, v)

		responses = cls.entity_class.update_many(entities)
		return entities, responses

	@classmethod
	def delete_single_entity_with_validations(cls,  id='', entity=None):
		'''
		Deletes a single entity and validates its removal.

		The method calls `delete_entities()`, then ensures that the entity no longer exists.

		Args:
			id (str, optional): Identifier of the entity to be deleted.
			entity (BaseEntity, optional): An existing entity instance to be deleted.

		Raises:
			ValidationError: If the entity still exists after deletion.
		'''
		ids = [id] if id != '' else []
		entities = [entity] if entity is not None else []

		[entity], [response] = cls.delete_entities(ids, entities)
		validate_response_uuid(response, entity)

		try:
			if cls.entity_class.fetch_entity(entity._id):
				raise ValidationError(f"Entity still exists after deletion {entity._id}")

		except BaseEntityError as e:
			# Allow the "CANT_FIND_ENTITY" system message to be ignored
			if len(e.args) != 2 or e.args[1].get('error', {}).get('id') != cls.entity_class.CANT_FIND_IDENTITY_SYSTEM_MESSAGE_ID:
				raise e

	@classmethod
	def delete_entities(cls, ids=None, entities=None):
		'''
		Deletes entity instances.

		If identifiers are provided, the corresponding entities are fetched first; otherwise, provided entity instances are used.
		The method then deletes all entities using `delete_many()`.

		Args:
			ids (list, optional): List of entity identifiers to be deleted.
			entities (list, optional): List of entity instances to be deleted.

		Returns:
			tuple: A tuple containing the list of deleted entity instances and their corresponding delete responses.
		'''
		ids = [] if ids is None else ids
		entities = [] if entities is None else entities

		if ids:
			for id in ids:
				fetched_entity = cls.entity_class.fetch_entity(id)
				entities.append(cls.entity_class(_id=fetched_entity._id, uuid=fetched_entity.uuid))

		responses = cls.entity_class.delete_many(entities)
		return entities, responses

	@classmethod
	def count_entities(cls, expected_entities):
		'''
		Validates the count of stored entities.

		The method retrieves the total count of entities and ensures it matches the expected value.

		Args:
			expected_entities (int): The expected number of stored entities.

		Raises:
			ValidationError: If the actual entity count does not match the expected count.
		'''
		entities_count = cls.entity_class.count()

		if entities_count != expected_entities:
			raise ValidationError(f"Expected {expected_entities}. Found {entities_count}")

	@classmethod
	def get_single_entity_test_identifier(cls):
		'''
		Generates an ID for single entity common tests.

		Returns:
			str: A unique identifier string for a single test entity.
		'''
		return f"{cls.entity_id_prefix}1"

	@classmethod
	def get_many_entities_test_identifiers(cls):
		'''
		Generates a list of IDs for many entities common tests.

		Returns:
			list: A list of unique identifier strings for multiple test entities.
		'''
		return [f"{cls.entity_id_prefix}1{i}" for i in range(cls.many_entities_test_count)]

	@staticmethod
	def get_default_to_update():
		'''Get dictionary with default values to update in common update tests.'''
		return {
			'description': 'Default description to update'
		}

	def test_001_save_single_generated_entity_with_validations(self, manager, simulator):
		id = self.get_single_entity_test_identifier()
		self.save_single_entity_with_validations(id)
		slash.context.existing_common_tests_identifiers[self.entity_class].add(id)

	def test_002_save_many_generated_entities(self, manager, simulator):
		ids = self.get_many_entities_test_identifiers()
		self.save_entities(ids)
		slash.context.existing_common_tests_identifiers[self.entity_class].update(ids)

	def test_003_update_single_generated_entity_with_validations(self, manager, simulator):
		self.update_single_entity_with_validations(self.get_single_entity_test_identifier(), to_update=self.get_default_to_update())

	def test_004_update_many_generated_entities(self, manager, simulator):
		self.update_entities(self.get_many_entities_test_identifiers(), to_update=self.get_default_to_update())

	def test_005_delete_single_generated_entity_with_validations(self, manager, simulator):
		id = list(slash.context.existing_common_tests_identifiers[self.entity_class])[-1]
		self.delete_single_entity_with_validations(id)
		slash.context.existing_common_tests_identifiers[self.entity_class].remove(id)

	def test_006_delete_many_generated_entities(self, manager, simulator):
		ids = list(slash.context.existing_common_tests_identifiers[self.entity_class])[-self.many_entities_test_delete_count:]
		self.delete_entities(ids)
		slash.context.existing_common_tests_identifiers[self.entity_class].difference_update(ids)

	def test_007_count_entities(self, manager, simulator):
		self.count_entities(len(slash.context.existing_common_tests_identifiers[self.entity_class]))

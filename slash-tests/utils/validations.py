# SPDX-FileCopyrightText: Copyright (c) 2026 NVIDIA CORPORATION & AFFILIATES. All rights reserved.
# SPDX-License-Identifier: Apache-2.0

from uuid import UUID

class ValidationError(Exception):
	'''Custom exception for validations.'''
	pass

class AttributeValidationError(ValidationError):
	'''Custom exception for attributes validations.'''
	pass


def validate_response_structure(response):
	'''
	Validate that the response dictionary adheres to the required structure.

	This function checks if the provided response dictionary contains exactly the required keys:
	'_id', 'uuid', 'success', 'error', and 'payload'

	Parameters:
		response (dict): The response dictionary to be validated.

	Raises:
		ValidationError: If there are any missing required keys or additional unexpected keys. The error message
			includes details about which keys are missing and which extra keys are found.
	'''
	requiredKeys = {'_id', 'uuid', 'success', 'error', 'payload'}
	responseKeys = set(response.keys())

	missingKeys = requiredKeys - responseKeys
	extraKeys = responseKeys - requiredKeys

	if missingKeys or extraKeys:
		error = ''

		if missingKeys:
			error += f"Missing required keys: {', '.join(missingKeys)}. "
		
		if extraKeys:
			error += f"Extra keys found: {', '.join(extraKeys)}. "
		
		if error:
			raise ValidationError(f"Response structure validation failed. response: {response}. error: {error}")

def validate_response_success(response):
	'''
	Validate that the API response indicates a successful operation.

	This function checks two key aspects of the response dictionary:
		1. That the 'success' key in the response is truthy.
		2. That the 'error' key in the response is not set or is falsy.

	Parameters:
		response (dict): The API response dictionary to validate

	Raises:
		ValidationError: If the 'success' key is missing or evaluates to False, or if an error is present.
	'''
	if not response.get('success'):
		raise ValidationError(f"API Response is not successful as expected: {response}")
	
	if response.get('error'): 
		raise ValidationError(f"API Response is including error not as expected while is showing success: {response}")

def validate_response_uuid(response, entity):
	'''
	Validates that the API response contains a properly formatted UUID and that it matches the UUID of the provided entity.

	Parameters: 
		response (dict): The API response expected to contain a 'uuid' key. 
		entity: A BaseEntity instance with a 'uuid' attribute representing the entity's UUID.

	Raises: 
		ValidationError: If the 'uuid' is missing or improperly formatted in the response, if the entity's UUID is missing, 
			or if the response's UUID does not correspond to the entity's UUID.
	'''
	responseUUID = response.get('uuid')

	if not responseUUID:
		raise ValidationError(f"No 'uuid' found on API Response: {response}")

	try:
		UUID(responseUUID)
	except ValueError:
		raise ValidationError(f"Invalid UUID format for 'uuid', API Response: {response}")

	entityUUID = entity.uuid

	if not entityUUID:
		raise ValidationError(f"No 'uuid' found on entity: {entity}")

	if (responseUUID != entityUUID):
		raise ValidationError(f"API Response 'uuid' is not corresponding to entity 'uuid': {responseUUID} != {entityUUID}")

def validate_attributes(expected, current):
	'''
	Recursively validate that the `current` attributes match the `expected` attributes.

	If `expected` or `current` are instances of `BaseEntity`, they are converted to dictionaries using their `to_dict` method. 
	The function supports validation for primitive types (int, str, bool, float), lists, and dictionaries. 
	Mismatches will raise an `AttributeValidationError`.

	Parameters:
		expected (BaseEntity | dict | list | int | str | bool | float): The expected attribute structure.
		current (BaseEntity | dict | list | int | str | bool | float): The current attribute structure to validate.

	Raises:
		AttributeValidationError: If any attribute does not match the expected value.
	'''
	# lazy import BaseEntity to avoid circular dependecy issue
	from entities.BaseEntity import BaseEntity
 
	expected = expected.to_dict() if isinstance(expected, BaseEntity) else expected
	current = current.to_dict() if isinstance(current, BaseEntity) else current
	keys_to_skip = ['dateModified']

	def _validate_attributes_recursively(expected, current, path="root"):
		if expected is None:
			return

		if current is None:
			raise AttributeValidationError(f"[{path}] Current value is None while expected is {expected}") 

		if isinstance(expected, (int, str, bool, float)):
			if expected != current:
				raise AttributeValidationError(f"[{path}] Expected {expected}, but got {current}")

		elif isinstance(expected, list):
			if not isinstance(current, list):
				raise AttributeValidationError(f"[{path}] Expected a list {expected}, but got {type(current).__name__}")

			# For each item in expected, ensure at least one matching item exists in current.
			for idx, expected_item in enumerate(expected):
				match_found = False
				for current_item in current:
					try:
						_validate_attributes_recursively(expected_item, current_item, f"{path}[{idx}]")
						match_found = True
						break
					except AttributeValidationError:
						continue
	
				if not match_found:
					raise AttributeValidationError(f"[{path}] Expected list item {expected_item} not found in current list.")

		elif isinstance(expected, dict):
			if not isinstance(current, dict):
				raise AttributeValidationError(f"[{path}] Expected a dict {expected}, but got {type(current).__name__}")

			for key, value in expected.items():
				if key in keys_to_skip:
					continue

				if key not in current:
					raise AttributeValidationError(f"[{path}] Key '{key}' is missing in current data. Expected keys: {list(expected.keys())}, Found: {list(current.keys())}.")
 
				_validate_attributes_recursively(value, current[key], f"{path}.{key}")
	
		else:
			raise AttributeValidationError(f"[{path}] Unexpected attribute format: {type(expected).__name__}")

	_validate_attributes_recursively(expected, current)

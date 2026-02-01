# SPDX-FileCopyrightText: Copyright (c) 2026 NVIDIA CORPORATION & AFFILIATES. All rights reserved.
# SPDX-License-Identifier: Apache-2.0

import slash

def requires_management(func):
	'''
	Decorator that ensures a management client is set before executing the method.

	Args:
		func (function): The method to wrap.

	Returns:
		function: Wrapped function that checks for a configured management client.

	Raises:
		ValueError: If the management client is not set.
	'''
	def wrapper(cls, *args, **kwargs):
		if not cls.management:
			raise ValueError('Management client instance is not configured. Call BaseEntity.set_management_client(mgmt_client) first.')
		
		return func(cls, *args, **kwargs)

	return wrapper

def not_implemented(func):
	'''Decorator that skip test with "Not Implemented" reason'''
	return slash.skipped('Not Implemented')(func)

def requires_class_attributes(*attrs, **custom_invalid):
	'''
	A class decorator that enforces the presence of specified class-level attributes in any subclass.

	For attributes provided as positional arguments, the attribute is considered invalid if its value is None or an empty string.
	For attributes provided as keyword arguments, the attribute is considered invalid only if its value equals the custom invalid value(s) provided.

	This decorator modifies the __init_subclass__ method of the decorated class to check that every subclass defines each attribute with a valid value. 
	If any attribute is missing or set to an invalid value, a NotImplementedError is raised during class creation.

	Args:
		*attrs: A variable-length argument list of strings representing the required class attribute names,
				which will be validated against the default invalid values (None and empty string).
		**custom_invalid: Keyword arguments where each key is an attribute name and each value is either a single
						  invalid value or an iterable of invalid values that define the disallowed values for that attribute.
						  For these attributes, the default invalid values are not applied.

	Returns:
		A decorator that can be applied to a class, enforcing the specified attribute presence on all its subclasses.

	Raises:
		NotImplementedError: If any subclass does not define one or more of the required attributes with a valid value.
	'''
	def wrapper(cls):
		_orig_init_subclass = getattr(cls, '__init_subclass__', None)

		@classmethod
		def new_init_subclass(subcls, **kwargs):
			# Call the original __init_subclass__ if it exists.
			if _orig_init_subclass:
				_orig_init_subclass(**kwargs)

			# Build a mapping of each attribute to a set of invalid values.
			invalid_map = {}
			for attr in attrs:
				invalid_map[attr] = {None, ''}

			for attr, custom in custom_invalid.items():
				if isinstance(custom, (list, tuple, set)) and not isinstance(custom, str):
					invalid_map[attr] = set(custom)
				else:
					invalid_map[attr] = {custom}

			# Look for missing attributes definition
			missing = []
			for attr, invalids in invalid_map.items():
				value = getattr(subcls, attr, None)

				if value in invalids:
					missing.append(attr)

			if missing:
				missing_str = ', '.join(f"'{attr}'" for attr in missing)
				raise NotImplementedError(f"{subcls.__name__} must define class-level attribute(s) with valid values: {missing_str}")
			
		cls.__init_subclass__ = new_init_subclass
		return cls
	return wrapper


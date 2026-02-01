# SPDX-FileCopyrightText: Copyright (c) 2026 NVIDIA CORPORATION & AFFILIATES. All rights reserved.
# SPDX-License-Identifier: Apache-2.0

from xlro.infra.fixtures import *

from testers.BaseTester import BaseTester
from entities.Key import Key

class KeyTester(BaseTester):
	entity_class = Key
	entity_id_prefix = 'key_'

	@staticmethod
	def get_default_to_update():
		return {
			'description': 'That\'s one small step for man, one giant leap for mankind'
		}

	def test_01_save_single_key_with_validations(self, manager, simulator):
		id = f"{self.entity_id_prefix}2"
		description = 'Houston, Tranquility Base here. The Eagle has landed'
		key = Key(_id=id, description=description)
		self.save_single_entity_with_validations(entity=key)

	def test_02_update_single_key_with_validations(self, manager, simulator):
		id = f"{self.entity_id_prefix}2"
		key = Key.fetch_entity(id)
		to_update = {
			'description': 'We came in peace for all mankind'
		}
		self.update_single_entity_with_validations(entity=key, to_update=to_update)

# SPDX-FileCopyrightText: Copyright (c) 2026 NVIDIA CORPORATION & AFFILIATES. All rights reserved.
# SPDX-License-Identifier: Apache-2.0

from xlro.infra.fixtures import *

from testers.BaseTester import BaseTester
from entities.TargetClass import TargetClass
from entities.Target import Target

class TargetClassTester(BaseTester):
	entity_class = TargetClass
	entity_id_prefix = 'target_class_'

	@staticmethod
	def get_default_to_update():
		return {
			'description': 'I\'m like King Midas in reverse here. Everything I touch turns to shit.'
		}

	def test_01_save_single_target_class_with_validations(self, manager, simulator):
		id = f"{self.entity_id_prefix}2"
		description = 'A wrong decision is better than indecision.'
		target_nodes = [target.get('_id') for target in Target.get(0, 5, {}, {}, {'_id': 1})]
		domains = [{ 'scope': 'weapon', 'identifier': weapon } for weapon in ['gun', 'knife']]
		target_class = TargetClass(name=id, description=description, targetNodes=target_nodes, domains=domains)
		self.save_single_entity_with_validations(entity=target_class)

	def test_02_update_single_target_class_with_validations(self, manager, simulator):
		id = f"{self.entity_id_prefix}2"
		target_class = TargetClass.fetch_entity(id)
		used_target_nodes = target_class.targetNodes
		fetched_target_nodes = [target.get('_id') for target in Target.get(0, 5, { '_id': { '$nin': used_target_nodes }}, {}, {'_id': 1})]
		target_class.targetNodes.pop()
		to_update = {
			'description': 'You know, Tony, it\'s a multiple-choice thing with you. \'Cause I can\'t tell if you\'re old-fashioned, you\'re paranoid, or just a f--king a--hole.',
			'targetNodes': target_class.targetNodes + fetched_target_nodes,
			'domains': [domain for domain in target_class.domains if domain.get('identifier') != 'knife'] + [{ 'scope': 'weapon', 'identifier': 'c4' }]
		}
		self.update_single_entity_with_validations(entity=target_class, to_update=to_update)

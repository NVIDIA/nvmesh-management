# SPDX-FileCopyrightText: Copyright (c) 2026 NVIDIA CORPORATION & AFFILIATES. All rights reserved.
# SPDX-License-Identifier: Apache-2.0

from xlro.infra.fixtures import *

from testers.BaseTester import BaseTester
from entities.DriveClass import DriveClass

class DriveClassTester(BaseTester):
	entity_class = DriveClass
	entity_id_prefix = 'drive_class_'

	@staticmethod
	def get_default_to_update():
		return {
			'description': 'The Matrix has you... Follow the white rabbit. Knock, Knock, Neo.'
		}

	def test_01_save_single_drive_class_with_validations(self, manager, simulator):
		id = f"{self.entity_id_prefix}2"
		description = 'You take the red pill... you stay in Wonderland, and I show you how deep the rabbit hole goes'
		drives = DriveClass.get_n_drive_class_entries(5)
		domains = [{ 'scope': 'pill', 'identifier': color } for color in ['red', 'bad_blue']]
		drive_class = DriveClass(_id=id, description=description, disks=drives, domains=domains)
		self.save_single_entity_with_validations(entity=drive_class)

	def test_02_update_single_drive_class_with_validations(self, manager, simulator):
		id = f"{self.entity_id_prefix}2"
		drive_class = DriveClass.fetch_entity(id)
		used_disk_ids = [disk.get('diskID') for disk in drive_class.disks]
		fetched_drive_class_entries = DriveClass.get_n_drive_class_entries(5, used_disk_ids)
		drive_class.disks.pop()
		to_update = {
			'description': 'I can only show you the door, you\'re the one that has to walk through it',
			'disks': drive_class.disks + fetched_drive_class_entries,
			'domains': [domain for domain in drive_class.domains if domain.get('identifier') != 'bad_blue'] + [{ 'scope': 'pill', 'identifier': 'blue' }]
		}
		self.update_single_entity_with_validations(entity=drive_class, to_update=to_update)

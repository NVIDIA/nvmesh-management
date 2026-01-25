# SPDX-FileCopyrightText: Copyright (c) 2026 NVIDIA CORPORATION & AFFILIATES. All rights reserved.
# SPDX-License-Identifier: Apache-2.0

from consts import REST_OP
from entities.BaseEntity import BaseEntity, BaseEntityError

class Drive(BaseEntity):
	endpoint = 'disks'
	CANT_FIND_IDENTITY_SYSTEM_MESSAGE_ID = 16271

	@classmethod
	def generate(cls, id):
		[response] = cls.get(0, 1)
		return Drive(**response)

	@property
	def identifier(self):
		return self.diskID

	@classmethod
	def get(cls, page=0, count=0, filter=None, sort=None, projection=None):
		responses = super().get(page, count, filter, sort, projection)
		return [response.get('disks') for response in responses]

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

	def evict(self):
		return self.post(REST_OP.EVICT_DRIVE, [self])

	@classmethod
	def evict_many(cls, entities):
		return cls.post(REST_OP.EVICT_DRIVE, entities)

	def format(self):
		return self.post(REST_OP.FORMAT, [self])

	@classmethod
	def format_many(cls, entities):
		return cls.post(REST_OP.FORMAT, entities)

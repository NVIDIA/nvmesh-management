# SPDX-FileCopyrightText: Copyright (c) 2026 NVIDIA CORPORATION & AFFILIATES. All rights reserved.
# SPDX-License-Identifier: Apache-2.0

from entities.BaseEntity import BaseEntity

class Key(BaseEntity):
	endpoint = 'keys'

	@classmethod
	def generate(cls, id):
		return Key(_id=id)

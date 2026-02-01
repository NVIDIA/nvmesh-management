# SPDX-FileCopyrightText: Copyright (c) 2026 NVIDIA CORPORATION & AFFILIATES. All rights reserved.
# SPDX-License-Identifier: Apache-2.0

from entities.BaseEntity import BaseEntity
from entities.Target import Target

class TargetClass(BaseEntity):
	endpoint = 'serverClasses'

	@classmethod
	def generate(cls, id):
		target_nodes = [target.get('_id') for target in Target.get(0, 1, {}, {}, {'_id': 1})]
		return TargetClass(name=id, targetNodes=target_nodes)


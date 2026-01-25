#!/bin/bash

# SPDX-FileCopyrightText: Copyright (c) 2026 NVIDIA CORPORATION & AFFILIATES. All rights reserved.
# SPDX-License-Identifier: Apache-2.0

mongosh management --eval 'db.server.updateMany({}, { $set: { health: "healthy", node_status: 1, tomaStatus: "up" } }, { multi: true })'
mongosh management --eval 'db.volume.updateMany({}, { $set: { status: "online", "chunks.$[].pRaids.$[].diskSegments.$[].status": "normal" } }, { multi: true })'


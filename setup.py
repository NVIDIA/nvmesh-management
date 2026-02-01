# SPDX-FileCopyrightText: Copyright (c) 2026 NVIDIA CORPORATION & AFFILIATES. All rights reserved.
# SPDX-License-Identifier: Apache-2.0

import setuptools

setuptools.setup(
    name="nvmesh-mgmt",
    version="0.0.1",
    author="Example Author",
    author_email="author@example.com",
    description="NVMesh Management SDK",
    long_description='''
    This is the management SDK
    ''',
    long_description_content_type="text/markdown",
    url="https://gitlab.acme.com/management/management",
    packages=["NVMeshSDK"],
    classifiers=[
        "Programming Language :: Python :: 2.7",
        "License :: OSI Approved :: MIT License",
        "Operating System :: OS Independent",
    ],
)

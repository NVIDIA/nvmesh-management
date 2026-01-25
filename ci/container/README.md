<!--
SPDX-FileCopyrightText: Copyright (c) 2026 NVIDIA CORPORATION & AFFILIATES. All rights reserved.
SPDX-License-Identifier: Apache-2.0
-->

# Setting up GitLab CI 

## Build CI runner docker image

```
cd ci/container
./build.sh
```

## Push image to GitLab Container Registry

### Acquire GitLab Access Token

### Login local docker client to GitLab Container Registry

In order to push the image you should first login to GitLab registry:
```
docker login gitlab-master.nvidia.com:5005
```

### Push image to regisrty

Once you have logged in to the gitlab registry locally you can push:

**WARNING:** This will override the current image used for CI runs
```
docker push gitlab-master.nvidia.com:5005/excelero/management/ci-runner:0.0.3
```


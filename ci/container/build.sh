# Building the image
# -----------------------
IMAGE_TAG=0.0.3

# builds the container with the tag to be pushed into the GitLab management project Container registry
docker build -t gitlab-master.nvidia.com:5005/excelero/management/ci-runner:$IMAGE_TAG .

# NOTES:

# Push to GitLab registry
# -----------------------
# to push the image you should first login to GitLab registry: docker login gitlab-master.nvidia.com:5005
# to get an access token please see: https://confluence.nvidia.com/pages/viewpage.action?pageId=732766723
# Once you have logged in to the gitlab reigstry locally you can push:
# <<<WARNING>>> This will override the current image used for CI runs
# docker push gitlab-master.nvidia.com:5005/excelero/management/ci-runner:latest


# List Images in Registry
# -----------------------
# you can list the images in GitLab dashboard > Management Project > Packages and Registry > Container Registry
# or click here: https://gitlab-master.nvidia.com/excelero/management/container_registry

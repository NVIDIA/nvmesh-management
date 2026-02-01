FROM registry.access.redhat.com/ubi7:latest


COPY ./yum-repos/mongodb.repo /etc/yum.repos.d/mongodb.repo
COPY ./yum-repos/centos-base.repo /etc/yum.repos.d/centos-base.repo

RUN curl -sL https://rpm.nodesource.com/setup_12.x -o nodesource_setup.sh \
    && bash nodesource_setup.sh \
    && yum install -y https://dl.fedoraproject.org/pub/epel/epel-release-latest-7.noarch.rpm \
    && yum install -y mongodb-org nodejs sudo python perl curl \
    && yum clean all \
    && rm -rf /var/cache/yum/*

ARG UTILS_PKG_FILE_NAME
ARG MGMT_PKG_FILE_NAME
ARG VERSION
ARG BUILD

### Labels required by RedHat OpenShift
LABEL name="NVMesh Management" \
      maintainer="support-nvmesh@nvidia.com" \
      vendor="NVIDIA" \
      version="$VERSION" \
      release="$BUILD" \
      summary="NVMesh Management is a part of the NVMesh storage solution" \
      description="NVMesh Management is a part of the NVMesh storage solution"

COPY licenses/ licenses/
COPY ./$UTILS_PKG_FILE_NAME /pkg/
COPY ./$MGMT_PKG_FILE_NAME /pkg/

# Install NVMesh Management
RUN yum -y install /pkg/$UTILS_PKG_FILE_NAME /pkg/$MGMT_PKG_FILE_NAME \
    && rm /pkg/$UTILS_PKG_FILE_NAME /pkg/$MGMT_PKG_FILE_NAME \
    && rm nodesource_setup.sh \
    && rm -rf /usr/share/doc/nodejs \
    && yum clean all \
    && rm -rf /var/cache/yum/*

# Copy init files
COPY ./init.sh .
COPY ./update_mgmt_config.js .

ENTRYPOINT ["./init.sh"]

EXPOSE 4000 4001 4002

# Environemnt Variables:

# FORCE_IP
# This is the IP other managements will use to connect to this management instance
# This IP on port 4001 should be accessible from other management instances
# Overrides config.forceIP in /etc/nvmesh/management.js.conf
# for example FORCE_IP="10.0.0.50"

# MONGO_SERVERS
# The Address of mongo servers (in the format "addr1:port1,addr2:port2")
# Overrides config.mongoConnection.hosts in /etc/nvmesh/management.js.conf
# For example MONGO_SERVERS="server1:27017",server2:27017"

# CONFIG
# OPTIONAL - configuration update obj that will be applied to /etc/nvmesh/management.js.conf
# in JSON Format. for example:  CONFIG='{ "mongoConnection" : { "options": { "replicaSetName": "rs0" } } }'

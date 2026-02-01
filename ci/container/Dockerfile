FROM --platform=linux/amd64 node:18-bullseye-slim

#ENV NODE_VERSION=16.13.0
ENV MONGO_VERSION=7.0


# Here we install the dependecies for all of the CI pipelines
RUN apt update
RUN apt install wget curl gnupg git -y

# Install NodeJS (In-case we don't start off of a node image)
# RUN wget -O - https://raw.githubusercontent.com/nvm-sh/nvm/v0.39.0/install.sh | bash
# ENV NVM_DIR=/root/.nvm
# RUN . "$NVM_DIR/nvm.sh" && nvm install ${NODE_VERSION}
# RUN . "$NVM_DIR/nvm.sh" && nvm use v${NODE_VERSION}
# RUN . "$NVM_DIR/nvm.sh" && nvm alias default v${NODE_VERSION}
# ENV PATH="/root/.nvm/versions/node/v${NODE_VERSION}/bin/:${PATH}"
# RUN node --version
# RUN npm --version

# Install MongoDB
RUN wget -qO - https://www.mongodb.org/static/pgp/server-${MONGO_VERSION}.asc | apt-key add -
RUN echo "deb [ arch=amd64,arm64 ] https://repo.mongodb.org/apt/ubuntu focal/mongodb-org/7.0 multiverse" > /etc/apt/sources.list.d/mongodb-org-${MONGO_VERSION}.list

RUN apt-get update
RUN apt-get install -y mongodb-org
RUN mkdir -p /data/db

# Install Dependencies for npm install
RUN apt install -y g++ make python3-pip
# Kafka systemd service installation

- [Kafka systemd service installation](#kafka-systemd-service-installation)
  - [Introduction](#introduction)
  - [Stand Alone Kafka Installation](#stand-alone-kafka-installation)
    - [Prerequisites](#prerequisites)
    - [Download](#download)
    - [Configure systemD service](#configure-systemd-service)
    - [Configure Kafka (KRaft, single node)](#configure-kafka-kraft-single-node)
    - [Format the storage directory](#format-the-storage-directory)
    - [Start using the service](#start-using-the-service)
    - [Testing](#testing)
  - [High Availability Kafka Installation](#high-availability-kafka-installation)
    - [Prerequisites - on all 3 servers](#prerequisites---on-all-3-servers)
    - [Download - on all 3 servers](#download---on-all-3-servers)
    - [Configure systemD service - on all 3 servers](#configure-systemd-service---on-all-3-servers)
    - [Configure Kafka (KRaft, 3-node quorum) - on all 3 servers](#configure-kafka-kraft-3-node-quorum---on-all-3-servers)
    - [Format the storage directory - on all 3 servers](#format-the-storage-directory---on-all-3-servers)
    - [Start using the service - on all 3 servers](#start-using-the-service---on-all-3-servers)
    - [Testing - run on a single server](#testing---run-on-a-single-server)

## Introduction

> Kafka is primarily used to build real-time streaming data pipelines and applications that adapt to the data streams. It combines messaging, storage, and stream processing to allow storage and analysis of both historical and real-time data.

As part of the Management-TOMA communication protocol, an instance of Kafka is required to run in order to allow both Management and TOMA components to produce and consume messages.

Starting with Kafka 4.x, ZooKeeper is no longer used. Cluster metadata is managed internally by Kafka itself using the **KRaft** (Kafka Raft) protocol, so a separate ZooKeeper service is not required and is no longer shipped with this repository.

The purpose of this document is to provide a simple way to install and configure Kafka **4.1.1** in KRaft mode as a systemd service.

***

## Stand Alone Kafka Installation

Instructions should be followed as **Super User**.

### Prerequisites

Kafka 4.x requires **Java 17** or newer.

Ubuntu:

```bash
apt install -y openjdk-17-jre-headless
```

EL:

```bash
yum install -y java-17-openjdk-headless
```

### Download

```bash
cd /opt/

wget https://downloads.apache.org/kafka/4.1.1/kafka_2.13-4.1.1.tgz
tar xf kafka_2.13-4.1.1.tgz
ln -s kafka_2.13-4.1.1/ kafka
rm -f kafka_2.13-4.1.1.tgz

cd -
```

### Configure systemD service

```bash
# Generally, it will be:
MANAGEMENT_DIRECTORY=/opt/nvmesh/management/

cp $MANAGEMENT_DIRECTORY/system.d/kafka.service /etc/systemd/system/

systemctl daemon-reload
```

### Configure Kafka (KRaft, single node)

Edit `/opt/kafka/config/server.properties` so that the node runs as a combined broker and controller and listens on the local interface:

```bash
sed -i 's|^process.roles=.*|process.roles=broker,controller|' /opt/kafka/config/server.properties
sed -i 's|^node.id=.*|node.id=1|' /opt/kafka/config/server.properties
sed -i 's|^controller.quorum.voters=.*|controller.quorum.voters=1@localhost:9093|' /opt/kafka/config/server.properties
sed -i 's|^listeners=.*|listeners=PLAINTEXT://:9092,CONTROLLER://:9093|' /opt/kafka/config/server.properties
sed -i 's|^advertised.listeners=.*|advertised.listeners=PLAINTEXT://localhost:9092|' /opt/kafka/config/server.properties
sed -i 's|^controller.listener.names=.*|controller.listener.names=CONTROLLER|' /opt/kafka/config/server.properties
sed -i 's|^log.dirs=.*|log.dirs=/var/lib/kafka/data|' /opt/kafka/config/server.properties

mkdir -p /var/lib/kafka/data /var/log/kafka
```

### Format the storage directory

KRaft requires the log directory to be formatted with a cluster UUID before the first start. The same UUID must be used on every node of the same cluster.

```bash
KAFKA_CLUSTER_ID=$(/opt/kafka/bin/kafka-storage.sh random-uuid)
echo $KAFKA_CLUSTER_ID
/opt/kafka/bin/kafka-storage.sh format -t $KAFKA_CLUSTER_ID -c /opt/kafka/config/server.properties
```

### Start using the service

```bash
systemctl enable --now kafka.service
```

### Testing

```bash
echo "This is a message" > /tmp/message
/opt/kafka/bin/kafka-console-producer.sh --bootstrap-server localhost:9092 --topic test < /tmp/message
/opt/kafka/bin/kafka-console-consumer.sh --bootstrap-server localhost:9092 --topic test --from-beginning
/opt/kafka/bin/kafka-topics.sh --delete --bootstrap-server localhost:9092 --topic test
```

***

## High Availability Kafka Installation

Instructions should be followed as **Super User**.

### Prerequisites - on all 3 servers

Kafka 4.x requires **Java 17** or newer.

Ubuntu:

```bash
apt install -y openjdk-17-jre-headless
```

EL:

```bash
yum install -y java-17-openjdk-headless
```

### Download - on all 3 servers

```bash
cd /opt/

wget https://downloads.apache.org/kafka/4.1.1/kafka_2.13-4.1.1.tgz
tar xf kafka_2.13-4.1.1.tgz
ln -s kafka_2.13-4.1.1/ kafka
rm -f kafka_2.13-4.1.1.tgz

cd -
```

### Configure systemD service - on all 3 servers

```bash
# Generally, it will be:
MANAGEMENT_DIRECTORY=/opt/nvmesh/management/

cp $MANAGEMENT_DIRECTORY/system.d/kafka.service /etc/systemd/system/

systemctl daemon-reload
```

### Configure Kafka (KRaft, 3-node quorum) - on all 3 servers

```bash
# Example of SERVER_N_IP variables:
# SERVER_1_IP=10.0.11.38
# SERVER_2_IP=10.0.11.39
# SERVER_3_IP=10.0.11.40

# nodeId must be unique per server - it is recommended to set those as 1, 2 and 3
# nodeId=1

mkdir -p /var/lib/kafka/data /var/log/kafka

# Each node runs as both broker and controller (combined mode).
sed -i "s|^process.roles=.*|process.roles=broker,controller|" /opt/kafka/config/server.properties
sed -i "s|^node.id=.*|node.id=${nodeId}|" /opt/kafka/config/server.properties
sed -i "s|^controller.quorum.voters=.*|controller.quorum.voters=1@${SERVER_1_IP}:9093,2@${SERVER_2_IP}:9093,3@${SERVER_3_IP}:9093|" /opt/kafka/config/server.properties
sed -i "s|^listeners=.*|listeners=PLAINTEXT://:9092,CONTROLLER://:9093|" /opt/kafka/config/server.properties
sed -i "s|^advertised.listeners=.*|advertised.listeners=PLAINTEXT://${HOSTNAME}:9092|" /opt/kafka/config/server.properties
sed -i "s|^controller.listener.names=.*|controller.listener.names=CONTROLLER|" /opt/kafka/config/server.properties
sed -i "s|^log.dirs=.*|log.dirs=/var/lib/kafka/data|" /opt/kafka/config/server.properties
```

Pay Attention: `${HOSTNAME}` should be accessible from your kafka client!

### Format the storage directory - on all 3 servers

KRaft requires the log directory to be formatted with a cluster UUID before the first start. **The same UUID must be used on every node of the cluster** — generate it once on a single server and reuse the value on the other two.

```bash
# Run on server 1 only:
KAFKA_CLUSTER_ID=$(/opt/kafka/bin/kafka-storage.sh random-uuid)
echo $KAFKA_CLUSTER_ID

# Then, on every server (server 1 included), using the same value:
/opt/kafka/bin/kafka-storage.sh format -t $KAFKA_CLUSTER_ID -c /opt/kafka/config/server.properties
```

### Start using the service - on all 3 servers

```bash
systemctl enable --now kafka.service
```

### Testing - run on a single server

```bash
# Confirm the controller quorum is healthy and a leader was elected
/opt/kafka/bin/kafka-metadata-quorum.sh --bootstrap-server ${SERVER_1_IP}:9092 describe --status

echo "This is a message" > /tmp/message
/opt/kafka/bin/kafka-console-producer.sh --bootstrap-server ${SERVER_1_IP}:9092,${SERVER_2_IP}:9092,${SERVER_3_IP}:9092 --topic test < /tmp/message
/opt/kafka/bin/kafka-console-consumer.sh --bootstrap-server ${SERVER_1_IP}:9092,${SERVER_2_IP}:9092,${SERVER_3_IP}:9092 --topic test --from-beginning
/opt/kafka/bin/kafka-topics.sh --delete --bootstrap-server ${SERVER_1_IP}:9092,${SERVER_2_IP}:9092,${SERVER_3_IP}:9092 --topic test
```

# Kafka systemd service installation

- [Kafka systemd service installation](#kafka-systemd-service-installation)
  - [Introduction](#introduction)
  - [Stand Alone Kakfa Installation](#stand-alone-kakfa-installation)
    - [Prerequisites](#prerequisites)
    - [Download](#download)
    - [Configure systemD services](#configure-systemd-services)
    - [Start using the services](#start-using-the-services)
    - [Testing](#testing)
  - [High Availability Kakfa Installation](#high-availability-kakfa-installation)
    - [Prerequisites - on all 3 servers](#prerequisites---on-all-3-servers)
    - [Download - on all 3 servers](#download---on-all-3-servers)
    - [Configure systemD services - on all 3 servers](#configure-systemd-services---on-all-3-servers)
    - [Configure ZooKeeper & Kafka - on all 3 servers](#configure-zookeeper--kafka---on-all-3-servers)
    - [Start using the services - on all 3 servers](#start-using-the-services---on-all-3-servers)
    - [Testing - run on a single server](#testing---run-on-a-single-server)

## Introduction

> Kafka is primarily used to build real-time streaming data pipelines and applications that adapt to the data streams. It combines messaging, storage, and stream processing to allow storage and analysis of both historical and real-time data.
>
> ZooKeeper is used in distributed systems for service synchronization and as a naming registry. When working with Apache Kafka, ZooKeeper is primarily used to track the status of nodes in the Kafka cluster and maintain a list of Kafka topics and messages.

As part of the new [Management-TOMA communication protocol](https://nvidia-my.sharepoint.com/:w:/p/tleibo/ETjA3UK2ODxJpyLNPGPEjQYBOlju4G2XzTuJy_o4oq9hSQ), an instance of Kafka together with ZooKeeper is required to run in order to allow both Management and TOMA components to produce and consume messages.

The purpose of this document is to provide a simple way to install and configure Kafka and ZooKeeper as a systemd service.

***

## Stand Alone Kakfa Installation

Instructions should be followed as **Super User**

### Prerequisites

Ubuntu:

```bash
apt install -y default-jdk
```

EL:

```bash
yum install -y java-1.8.0-openjdk
```

### Download

```bash
cd /opt/

wget https://downloads.apache.org/kafka/3.2.0/kafka_2.12-3.2.0.tgz
tar xf kafka_2.12-3.2.0.tgz
ln -s kafka_2.12-3.2.0/ kafka
rm -f kafka_2.12-3.2.0.tgz

cd -
```

### Configure systemD services

```bash
# Generally, it will be:
MANAGEMENT_DIRECTORY=/opt/nvmesh/management/

cp $MANAGEMENT_DIRECTORY/system.d/kafka-zookeeper.service /etc/systemd/system/
cp $MANAGEMENT_DIRECTORY/system.d/kafka.service /etc/systemd/system/

systemctl daemon-reload
```

### Start using the services

```bash
systemctl enable --now kafka-zookeeper.service kafka.service
```

### Testing

```bash
echo "This is a message" > /tmp/message
/opt/kafka/bin/kafka-console-producer.sh --bootstrap-server localhost:9092 --topic test < /tmp/message
/opt/kafka/bin/kafka-console-consumer.sh --bootstrap-server localhost:9092 --topic test --from-beginning
/opt/kafka/bin/kafka-topics.sh --delete --bootstrap-server localhost:9092 --topic test
```

***

## High Availability Kakfa Installation

Instructions should be followed as **Super User**

### Prerequisites - on all 3 servers

Ubuntu:

```bash
apt install -y default-jdk
```

EL:

```bash
yum install -y java-1.8.0-openjdk
```

### Download - on all 3 servers

```bash
cd /opt/

wget https://downloads.apache.org/kafka/3.2.0/kafka_2.12-3.2.0.tgz
tar xf kafka_2.12-3.2.0.tgz
ln -s kafka_2.12-3.2.0/ kafka
rm -f kafka_2.12-3.2.0.tgz

cd -
```

### Configure systemD services - on all 3 servers

```bash
# Generally, it will be:
MANAGEMENT_DIRECTORY=/opt/nvmesh/management/

cp $MANAGEMENT_DIRECTORY/system.d/kafka-zookeeper.service /etc/systemd/system/
cp $MANAGEMENT_DIRECTORY/system.d/kafka.service /etc/systemd/system/

systemctl daemon-reload
```

### Configure ZooKeeper & Kafka - on all 3 servers

```bash
# Example of SERVER_N_IP variables:
# SERVER_1_IP=10.0.11.38
# SERVER_2_IP=10.0.11.39
# SERVER_3_IP=10.0.11.40

# the clusterID should differ between each servers - it is recommended to set those as 1, 2 and 3
# clusterID=1

mkdir -p /zookeeper
echo ${clusterID} > /zookeeper/myid

sed -i "s/^dataDir=\/tmp\/zookeeper/dataDir=\/zookeeper/g" /opt/kafka/config/zookeeper.properties
echo "server.1=${SERVER_1_IP}:2888:3888" >> /opt/kafka/config/zookeeper.properties
echo "server.2=${SERVER_2_IP}:2888:3888" >> /opt/kafka/config/zookeeper.properties
echo "server.3=${SERVER_3_IP}:2888:3888" >> /opt/kafka/config/zookeeper.properties
echo "initLimit=10" >> /opt/kafka/config/zookeeper.properties
echo "syncLimit=5" >> /opt/kafka/config/zookeeper.properties

sed -i "s/^broker.id=0/broker.id=$clusterID/g" /opt/kafka/config/server.properties
sed -i "s/^zookeeper.connect=localhost:2181/zookeeper.connect=${SERVER_1_IP}:2181,${SERVER_2_IP}:2181,${SERVER_3_IP}:2181/g" /opt/kafka/config/server.properties
echo "listeners=PLAINTEXT://:9092" >> /opt/kafka/config/server.properties
echo "advertised.listeners=PLAINTEXT://${HOSTNAME}:9092" >> /opt/kafka/config/server.properties
```

Pay Attention: `${HOSTNAME}` should be accessible from your kafka client!

### Start using the services - on all 3 servers

```bash
systemctl enable --now kafka-zookeeper.service kafka.service
```

### Testing - run on a single server

```bash
# Validate the following is sent from the leader node
echo srvr | nc localhost 2181 | grep Mode

echo "This is a message" > /tmp/message
/opt/kafka/bin/kafka-console-producer.sh --bootstrap-server ${SERVER_1_IP}:9092,${SERVER_2_IP}:9092,${SERVER_3_IP}:9092 --topic test < /tmp/message
/opt/kafka/bin/kafka-console-consumer.sh --bootstrap-server ${SERVER_1_IP}:9092,${SERVER_2_IP}:9092,${SERVER_3_IP}:9092 --topic test --from-beginning
/opt/kafka/bin/kafka-topics.sh --delete --bootstrap-server ${SERVER_1_IP}:9092,${SERVER_2_IP}:9092,${SERVER_3_IP}:9092 --topic test
```

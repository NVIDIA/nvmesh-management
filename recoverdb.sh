#!/usr/bin/env bash
if [ "$EUID" -ne 0 ]; then
    echo "Script needs to be run as root"
    exit
fi
dbpath=`cat /etc/mongod.conf | grep 'dbPath' | awk '{print $2}'`

echo "Recovering database at ${dbpath}"
service mongod stop

echo "Deleting pid file"
rm /var/run/mongodb/mongod.pid

rm {dbpath}.lock 2> /dev/null
if [[ "$?" -eq 0 ]]; then echo "Lock file deleted"; fi

sock=`ls /tmp/mongodb-*.sock 2> /dev/null`
if [[ "$?" -eq 0 ]]; then
    echo "Sock file found";
    rm -f /tmp/mongodb-*.sock
fi

mongod --dbpath ${dbpath} --repair 1> /dev/null
echo "Repair complete. Restarting service"
chown -R mongod:mongod ${dbpath}
service mongod start
echo "Mongo successfully recovered"
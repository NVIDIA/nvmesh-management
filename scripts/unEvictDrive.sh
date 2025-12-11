#!/bin/bash

MDIR="/opt/nvmesh/management"

usage() {
	echo "Usage: $0 <driveSerialNumber>"
	echo "Example: $0 S3HCNX0K800794"
	exit 1
}

if [ $# -ne 1 ]; then
	usage
fi

SERIAL_NUMBER="$1"

echo "Attempting to unEvict drive with Serial Number: ${SERIAL_NUMBER}"

if [[ ! -f "${MDIR}/modules/mongoCMDLineArgsBuilder.js" ]]; then
    echo "Error: MongoDB connection module not found at ${MDIR}/modules/mongoCMDLineArgsBuilder.js"
    exit 1
fi

commandLineArguments=$(node --eval "console.log(require('${MDIR}/modules/mongoCMDLineArgsBuilder.js').buildMongoConnectionCommandlineArgsByConnectionName('mongoConnection'))")

if [ -z "$commandLineArguments" ]; then
	echo "Error: Failed to get MongoDB connection arguments"
	exit 1
fi

result=$(mongosh --quiet $commandLineArguments --eval "
	const result = db.server.updateOne(
		{ 'disks.Serial_Number': '${SERIAL_NUMBER}' },
		{ \$set: { 'disks.\$.isOutOfService': false } }
	);

	if (result.matchedCount === 0) {
		print('ERROR: No drive found with Serial Number: ${SERIAL_NUMBER}');
		quit(1);
	}

	if (result.modifiedCount === 0) {
		print('Drive with Serial Number ${SERIAL_NUMBER} was already in service');
	} else {
		print('Successfully unEvicted drive with Serial Number: ${SERIAL_NUMBER}');
	}
")

rc=$?

echo "$result"
exit $rc


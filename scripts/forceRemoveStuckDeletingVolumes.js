/* global db */

// This script is used to force remove stuck deleting volumes from the database.
// The script will not re-calculate the drive's largest segment available again. Creating a new volume will do that.

let volumesToRemove = db.volume.find({ action: 'markedForDeletion' }).toArray();

print(`Going to remove ${volumesToRemove.length} volumes`);

for (let volume of volumesToRemove) {
	print(`Starting to delete the volume ${volume._id}`);
	print('Removing volumes segments');

	let segmentsToRemove = [];

	volume.chunks.forEach(c => {
		c.pRaids.forEach(p => {
			segmentsToRemove = segmentsToRemove.concat(p.diskSegments);
		});
	});

	print(`Going to remove ${segmentsToRemove.length} segments`);

	for (let segment of segmentsToRemove) {
		print(`Removing segment: ${segment._id} from node: ${segment.node_id} from drive: ${segment.diskID}`);

		let result = db.server.updateOne({ _id: segment.node_id }, {
			$pull: { 'disks.$[disk].diskSegments': { uuid: segment.uuid } }
		}, { arrayFilters: [{ 'disk.diskID': segment.diskID }] });

		print(`Result: ${JSON.stringify(result)}`);
	}

	print('Finished removing segments, removing the volume');
	print(`Removing volume: ${volume._id}`);

	let result = db.volume.deleteOne({ _id: volume._id });
	print(`Result: ${JSON.stringify(result)}`);
}

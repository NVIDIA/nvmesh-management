from xlro.infra.fixtures import *

from testers.BaseTester import BaseTester
from entities.NvmeshMetadata import NvmeshMetadata
from utils.decorators import not_implemented
from utils.validations import ValidationError

class NvmeshMetadataTester(BaseTester):
	entity_class = NvmeshMetadata
	entity_id_prefix = 'nvmesh_metadata_'

	@not_implemented
	def test_001_save_single_generated_entity_with_validations(self, manager, simulator):
		pass

	@not_implemented
	def test_002_save_many_generated_entities(self, manager, simulator):
		pass

	@not_implemented
	def test_003_update_single_generated_entity_with_validations(self, manager, simulator):
		pass

	@not_implemented
	def test_004_update_many_generated_entities(self, manager, simulator):
		pass

	@not_implemented
	def test_005_delete_single_generated_entity_with_validations(self, manager, simulator):
		pass

	@not_implemented
	def test_006_delete_many_generated_entities(self, manager, simulator):
		pass

	@not_implemented
	def test_007_count_entities(self, manager, simulator):
		pass

	def test_01_update_cluster_id(self, manager, simulator):
		cluster = NvmeshMetadata.get_cluster()
		new_cluster_id = "Buggy Cluster!"

		if cluster.id == new_cluster_id:
			raise ValidationError(f"Unexpected cluster ID: {cluster.id} same as {new_cluster_id}")

		cluster.clusterID = new_cluster_id
		cluster.update_cluster_id()

		cluster = NvmeshMetadata.get_cluster()
		if cluster.id != new_cluster_id:
			raise ValidationError(f"Cluster ID is not updated as expected: {cluster.id} != {new_cluster_id}")

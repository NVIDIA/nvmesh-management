const async = require('async');

const logger = require('../logger.js');
const consts = require('../consts.js');
const { Entities, SystemMessage, Differentiators, SystemAdminMessage } = require('./error.js');
const { getDistributionTypes, createOperatingSystems, getOperatingSystems } = require('./operatingSystem.js');
const { createKernels, getKernels } = require('./kernel.js');
const { createOfeds, getOfeds } = require('./ofed.js');
const { getAllArchTypes, createPlatforms, getAllPlatforms } = require('./platform.js');
const { getAllReleases, updateReleases, createReleases } = require('./release.js');
const { getAllArtifacts, createArtifacts } = require('./artifacts.js');
const { createComponents, getAllComponentTypes, getAllComponents, getAllComponentVersions, updateComponents } = require('./component.js');
const { compareVersionRelease } = require('../utils.js');
const { getAllUpgrades, getAllUpgradeTypes, createUpgrades, updateUpgrades } = require('./upgradeScenario.js');
const systemMessages = require('../systemMessages.js');

const scope = {};

const mapEntityIdsByName = (entities, key) => {
	const getKey = typeof key === 'function' ? key : entity => entity[key];

	return entities.reduce((acc, entity) => {
		acc[getKey(entity)] = entity.ID;
		return acc;
	}, {});
};

const fetchEntityIdsByNameCallback = (error, entities, entityName, keyExtractor, queryObj, callback) => {
	if (error)
		return callback(error);

	const idByNameMap = mapEntityIdsByName(entities, keyExtractor);
	const queryString = (queryObj && Object.keys(queryObj).length > 0) ? ` with query: ${JSON.stringify(queryObj)}` : '';
	logger.sysDEBUG(`${entityName}s ID by names found${queryString}:`, idByNameMap);

	callback(null, idByNameMap);
};

const groupResponsesByStatus = (responses, checkUniqueViolation) => {
	const groupedResponses = { success: [], failed: [] };
	if (checkUniqueViolation)
		groupedResponses.alreadyExisting = [];

	return responses.reduce((acc, response) => {
		if (response.isError()) {
			if (checkUniqueViolation && response.getAdditionalInfoByKey(Entities.Error)?.isUniqueViolationError)
				acc.alreadyExisting.push(response);
			else
				acc.failed.push(response);
		} else
			acc.success.push(response);
		return acc;
	}, groupedResponses);
};

const fetchDistributionTypeIdsByName = (queryObj = {}, callback) => {
	getDistributionTypes(queryObj, (error, distributionTypes) =>
		fetchEntityIdsByNameCallback(error, distributionTypes, consts.entity.distributionType, 'name', queryObj, callback));
};

const fetchArchTypeIdsByName = callback => {
	getAllArchTypes(archTypes =>
		fetchEntityIdsByNameCallback(null, archTypes, consts.entity.archType, 'name', null, callback));
};

const fetchOperatingSystemIdsByName = (queryObj = {}, callback) => {
	getOperatingSystems(queryObj, (error, oss) =>
		fetchEntityIdsByNameCallback(error, oss, consts.entity.operatingSystem, os => `${os.distributionType} - ${os.version}`, queryObj, callback));
};

const fetchKernelIdsByName = (queryObj = {}, callback) => {
	getKernels(queryObj, (error, kernels) =>
		fetchEntityIdsByNameCallback(error, kernels, consts.entity.kernel, 'version', queryObj, callback));
};

const fetchOfedIdsByName = (queryObj = {}, callback) => {
	getOfeds(queryObj, (error, ofeds) =>
		fetchEntityIdsByNameCallback(error, ofeds, consts.entity.ofed, 'version', queryObj, callback));
};

const fetchComponentTypeIdsByName = callback => {
	getAllComponentTypes(componentTypes =>
		fetchEntityIdsByNameCallback(null, componentTypes, consts.entity.componentType, 'name', null, callback));
};

const fetchComponentIdsByName = (queryObj = {}, eagerLoading = false, callback) => {
	getAllComponents(queryObj, eagerLoading, (error, components) =>
		fetchEntityIdsByNameCallback(error, components, consts.entity.component, 'name', queryObj, callback));
};

const fetchUpgradeTypeIdsByName = callback => {
	getAllUpgradeTypes((error, upgradeTypes) =>
		fetchEntityIdsByNameCallback(error, upgradeTypes, consts.entity.upgradeType, 'name', null, callback));
};

const fetchReleaseIdsByName = (queryObj = {}, callback) => {
	getAllReleases(queryObj, (error, releases) =>
		fetchEntityIdsByNameCallback(error, releases, consts.entity.release, 'version', queryObj, callback));
};

const fetchPlatformIdsByName = (queryObj = {}, callback) => {
	getAllPlatforms(queryObj, (error, platforms) =>
		fetchEntityIdsByNameCallback(error, platforms, consts.entity.platform, 'name', queryObj, callback));
};

const prepareOperatingSystems = (requestedOperatingSystems, callback) => {
	logger.sysDEBUG('Preparing operating systems:', requestedOperatingSystems);

	fetchDistributionTypeIdsByName({}, (error, distributionTypeIDbyName) => {
		if (error)
			return callback(error);

		const operatingSystems = [];
		const missingDistributionTypes = [];

		const isOsAlreadyAdded = newOs => operatingSystems.some(os =>
			os.distributionTypeID === distributionTypeIDbyName[newOs.distributionType] &&
			os.version === newOs.version);

		for (const requestedOperatingSystem of requestedOperatingSystems) {
			// handle inexistent distribution types
			if (!distributionTypeIDbyName[requestedOperatingSystem.distributionType]) {
				missingDistributionTypes.push(requestedOperatingSystem.distributionType);
				continue;
			}

			// handle duplicates
			if (isOsAlreadyAdded(requestedOperatingSystem))
				continue;

			// create new operating system payload
			operatingSystems.push({
				distributionTypeID: distributionTypeIDbyName[requestedOperatingSystem.distributionType],
				version: requestedOperatingSystem.version
			});
		}

		if (missingDistributionTypes.length)
			return callback(missingDistributionTypes.reduce(
				(acc, distributionType) => acc.addInfo(Entities.OperatingSystem.distributionType, distributionType),
				new SystemMessage(systemMessages.MISSING_DISTRIBUTION_TYPES)));

		logger.sysDEBUG('Operating systems after preparation:', operatingSystems);
		callback(null, operatingSystems);
	});
};

const prepareKernels = (requestedKernels, cb) => cb(null, getUniqueStrings(requestedKernels, consts.entity.kernel));
const prepareOfeds = (requestedOfeds, cb) => cb(null, getUniqueStrings(requestedOfeds, consts.entity.ofed));

const preparePlatforms = (requestedPlatforms, cb) => {
	logger.sysDEBUG('Preparing platforms:', requestedPlatforms);

	fetchPlatformDependencyIdsByName(requestedPlatforms, (error, propertiesIDByName) => {
		if (error)
			return cb(error);

		logger.sysDEBUG('Platforms properties ID by names:', propertiesIDByName);
		const { archTypeIDByName, operatingSystemIDByName, kernelIDByName, ofedIDByName } = propertiesIDByName;

		const platforms = [];
		const errors = [];

		for (const requestedPlatform of requestedPlatforms) {
			const missingEntities = {};

			// handle inexistent entities
			if (!archTypeIDByName[requestedPlatform.arch])
				missingEntities[Entities.ArchType.name] = requestedPlatform.arch;
			if (!operatingSystemIDByName[`${requestedPlatform.os.distributionType} - ${requestedPlatform.os.version}`])
				missingEntities[Entities.OperatingSystem.version] = `${requestedPlatform.os.distributionType} - ${requestedPlatform.os.version}`;
			if (!kernelIDByName[requestedPlatform.kernel])
				missingEntities[Entities.Kernel.version] = requestedPlatform.kernel;
			if (!ofedIDByName[requestedPlatform.ofed])
				missingEntities[Entities.Ofed.version] = requestedPlatform.ofed;

			if (Object.keys(missingEntities).length) {
				errors.push(Object.entries(missingEntities).reduce(
					(acc, [entity, value]) => acc.addInfo(entity, value),
					new SystemMessage(systemMessages.MISSING_PLATFORM_DEPENDENCIES).addInfo(Entities.Platform.name, requestedPlatform.name)));
				continue;
			}

			// create new platform payload
			platforms.push({
				name: requestedPlatform.name,
				archTypeID: archTypeIDByName[requestedPlatform.arch],
				operatingSystemID: operatingSystemIDByName[`${requestedPlatform.os.distributionType} - ${requestedPlatform.os.version}`],
				kernelID: kernelIDByName[requestedPlatform.kernel],
				ofedID: ofedIDByName[requestedPlatform.ofed]
			});
		}

		if (errors.length)
			return cb(errors.reduce(
				(acc, error) => acc.addInfo(Entities.Error, error),
				new SystemMessage(systemMessages.MISSING_PLATFORMS_DEPENDENCIES)));

		logger.sysDEBUG('Platforms after preparation:', platforms);
		cb(null, platforms);
	});
};

const handleOperatingSystemsResponses = (groupedResponses, callback) =>
	handleCreationResponses(
		groupedResponses,
		consts.entity.operatingSystem,
		[Entities.OperatingSystem.distributionType, Entities.OperatingSystem.version],
		callback,
	);

const handleKernelsResponses = (groupedResponses, cb) =>
	handleCreationResponses(groupedResponses, consts.entity.kernel, [Entities.Kernel.version], cb);

const handleOfedsResponses = (groupedResponses, cb) =>
	handleCreationResponses(groupedResponses, consts.entity.ofed, [Entities.Ofed.version], cb);

const handlePlatformsResponses = (groupedResponses, callback) =>
	handleCreationResponses(groupedResponses, consts.entity.platform, [Entities.Platform.name], callback);

const handleArtifactsResponses = (groupedResponses, callback) =>
	handleCreationResponses(groupedResponses, consts.entity.artifact, [Entities.Artifact.name], callback);

const getUniqueStrings = (items, entityName) => {
	logger.sysDEBUG(`Getting unique ${entityName}:`, items);

	const uniqueItems = [...new Set(items)];
	logger.sysDEBUG(`${entityName} after getting unique:`, uniqueItems);

	return uniqueItems;
};

const handleCreationResponses = (groupedResponses, entityName, additionalInfoKeys, callback) => {
	if (groupedResponses.alreadyExisting.length) {
		const alreadyExistingEntities = groupedResponses.alreadyExisting.map(response =>
			additionalInfoKeys.map(key => `${key}: ${response.getAdditionalInfoByKey(key)}`).join(' - '));
		logger.sysDEBUG(`Already existing ${entityName}:`, alreadyExistingEntities.join(', '));
	}

	if (groupedResponses.success.length)
		groupedResponses.success.forEach(response => response.log());

	if (groupedResponses.failed.length)
		return callback(groupedResponses.failed.reduce(
			(acc, response) => acc.addInfo(Entities.Error, response),
			new SystemMessage(systemMessages.FAILED_TO_CREATE_ENTITIES)));

	callback(null, groupedResponses.success);
};

const handleUpdateResponses = (responses, onErrorSystemMessage, callback) => {
	const groupedResponses = groupResponsesByStatus(responses);

	if (groupedResponses.success.length)
		groupedResponses.success.forEach(response => response.log());

	if (groupedResponses.failed.length)
		return callback(groupedResponses.failed.reduce(
			(acc, response) => acc.addInfo(Entities.Error, response),
			new SystemMessage(onErrorSystemMessage)));

	callback();
};

const fetchPlatformDependencyIdsByName = (platforms, callback) => {
	async.parallel({
		archTypeIDByName: fetchArchTypeIdsByName,
		operatingSystemIDByName: cb => {
			fetchDistributionTypeIdsByName({}, (error, distributionTypeIDbyName) => {
				if (error)
					return cb(error);

				const queryObj = {
					filter: {
						distributionTypeID: { $in: platforms.map(platform => distributionTypeIDbyName[platform.os.distributionType]) },
						version: { $in: platforms.map(platform => platform.os.version) }
					}
				};

				fetchOperatingSystemIdsByName(queryObj, cb);
			});
		},
		kernelIDByName: cb => {
			const queryObj = {
				filter: {
					version: { $in: platforms.map(platform => platform.kernel) }
				}
			};

			fetchKernelIdsByName(queryObj, cb);
		},
		ofedIDByName: cb => {
			const queryObj = {
				filter: {
					version: { $in: platforms.map(platform => platform.ofed) }
				}
			};

			fetchOfedIdsByName(queryObj, cb);
		},
	}, callback);
};

const createEntities = (requestedEntities, prepareEntitiesFn, createEntitiesFn, handleResponsesFn, callback) => {
	if (!requestedEntities?.length)
		return callback();

	prepareEntitiesFn(requestedEntities, (error, entities) => {
		if (error)
			return callback(error);

		createEntitiesFn(entities, responses =>
			handleResponsesFn(groupResponsesByStatus(responses, true), callback));
	});
};

const createPlatformsAndDependencies = (platforms, callback) => {
	async.series([
		cb => createEntities(platforms.map(p => p.os), prepareOperatingSystems, createOperatingSystems, handleOperatingSystemsResponses, cb),
		cb => createEntities(platforms.map(p => p.kernel), prepareKernels, createKernels, handleKernelsResponses, cb),
		cb => createEntities(platforms.map(p => p.ofed), prepareOfeds, createOfeds, handleOfedsResponses, cb),
		cb => createEntities(platforms, preparePlatforms, createPlatforms, handlePlatformsResponses, cb),
	], callback);
};

const createOrUpdateRelease = (releaseName, requestedArtifacts, callback) => {
	logger.sysDEBUG(`Creating or updating release ${releaseName} with artifacts: ${requestedArtifacts.join(', ')}`);

	getAllReleases({ filter: { version: releaseName } }, (error, existingReleases) => {
		if (error)
			return callback(error);

		const existingRelease = existingReleases[0];

		function performReleaseAction(artifacts) {
			const release = { version: releaseName, artifacts };
			const action = existingRelease ? updateReleases : createReleases;
			const actionName = existingRelease ? 'update' : 'create';

			if (existingRelease) {
				release.ID = existingRelease.ID;
				release.artifacts = [...existingRelease.artifacts, ...artifacts];
			}

			logger.sysDEBUG(`Going to ${actionName} release ${releaseName} with artifacts:`, release.artifacts.map(a => a.name));

			action([release], responses => {
				const response = responses[0];

				if (response.isError())
					return callback(new SystemMessage(systemMessages.FAILED_CREATE_UPDATE_RELEASE)
						.addInfo(Entities.Release.name, releaseName)
						.addInfo(Entities.Error, response));

				response.log();
				callback();
			});
		}

		if (!requestedArtifacts.length)
			return performReleaseAction([]);

		getAllArtifacts({ filter: { name: { $in: requestedArtifacts } } }, (error, artifacts) => {
			if (error)
				return callback(error);

			if (requestedArtifacts.length !== artifacts.length)
				return callback(requestedArtifacts
					.filter(artifact => !artifacts.some(a => a.name === artifact))
					.reduce((acc, artifact) => acc.addInfo(Entities.Artifact.name, artifact),
						new SystemMessage(systemMessages.MISSING_ARTIFACTS_IN_RELEASE).addInfo(Entities.Release.name, releaseName)));

			performReleaseAction(artifacts);
		});
	});
};

// returns a list of artifacts with the platforms they belong to - [{'nvmesh-client.3.3.2-1.1.1.rpm': ['GFN1', 'GFN1_Relaxed']}]
const groupPlatformsByArtifacts = requestedPlatforms => {
	const platformsByArtifacts = {};
	const result = [];

	requestedPlatforms.forEach(({ name: platformName, artifacts }) => {
		artifacts.forEach(artifactName => {
			if (!platformsByArtifacts[artifactName]) {
				const newArtifact = { name: artifactName, platforms: [] };
				// platformName might be null if the artifact is not associated with any platform
				if (platformName)
					newArtifact.platforms.push(platformName);

				platformsByArtifacts[artifactName] = newArtifact;
				result.push(newArtifact);
			} else {
				// modify the platformsByArtifacts will affect the result entry already pushed
				// platformName might be null if the artifact is not associated with any platform
				if (platformName)
					platformsByArtifacts[artifactName].platforms.push(platformName);
			}
		});
	});

	return result;
};

const prepareArtifacts = (requestedPlatforms, callback) => {
	logger.sysDEBUG('Preparing artifacts:', requestedPlatforms);

	const platformsByArtifacts = groupPlatformsByArtifacts(requestedPlatforms);
	logger.sysDEBUG('Platforms by artifacts:', platformsByArtifacts);

	const requestObj = {
		filter: {
			name: { $in: requestedPlatforms.filter(platform => platform.name).map(platform => platform.name) }
		}
	};

	fetchPlatformIdsByName(requestObj, (error, platformIDbyName) => {
		if (error)
			return callback(error);

		const errors = [];
		const artifacts = [];

		for (const { name: artifactName, platforms: platformNames } of platformsByArtifacts) {
			// handle missing platforms
			const missingPlatforms = platformNames.filter(platformName => !platformIDbyName[platformName]);
			if (missingPlatforms.length) {
				errors.push(missingPlatforms.reduce(
					(acc, platformName) => acc.addInfo(Entities.Platform.name, platformName),
					new SystemMessage(systemMessages.MISSING_PLATFORMS_IN_ARTIFACT).addInfo(Entities.Artifact.name, artifactName)));
				continue;
			}

			// create new artifact payload
			const newArtifact = {
				name: artifactName,
				platforms: platformNames.map(platformName => ({ ID: platformIDbyName[platformName] }))
			};

			artifacts.push(newArtifact);
		}

		if (errors.length)
			return callback(errors.reduce(
				(acc, error) => acc.addInfo(Entities.Error, error),
				new SystemMessage(systemMessages.MISSING_PLATFORMS_IN_ARTIFACTS)));

		logger.sysDEBUG('Artifacts after preparation:', artifacts);
		callback(null, artifacts);
	});
};


// extract the versions from artifacts - { 'nvmesh-client': '3.3.2', 'nvmesh-exporter': '1.0.1' }
// artifacts names are parsed to extract the component name and base version
const extractVersionsFromArtifacts = (artifacts, componentNames) => {
	const result = {};

	for (const artifact of artifacts) {
		const artifactName = artifact.name;

		for (const componentName of componentNames) {
			const escapedComponentName = componentName.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
			const regex = new RegExp(`^${escapedComponentName}[-_]([0-9]+\\.[0-9]+\\.[0-9]+)`);
			const match = artifactName.match(regex);

			if (match) {
				const baseVersion = match[1];
				if (result[componentName] && result[componentName] !== baseVersion) {
					const error = new SystemMessage(systemMessages.MORE_THAN_ONE_ARTIFACT_BASE_VERSION_FOR_COMPONENT)
						.addInfo(Entities.Component.name, componentName)
						.addInfo(Entities.Component.version, result[componentName], Differentiators.First)
						.addInfo(Entities.Component.version, baseVersion, Differentiators.Second);
					return [error, result];
				}

				result[componentName] = baseVersion;
				break; // Move to next artifact once component is identified
			}
		}
	}

	return [null, result];
};

// get the base version for each component by the release name and component name - { '3.3.2-HF1': { 'nvmesh-client': '3.3.2', 'nvmesh-exporter': '1.0.1' } }
// base versions and component names are parsed from the artifact names which are linked to the releaseName
const fetchVersionsForReleases = (releaseNames, callback) => {
	logger.sysDEBUG(`Fetching base versions by component names for releases ${releaseNames.join(', ')}`);

	getAllReleases({ filter: { version: { $in: releaseNames } } }, (error, releases) => {
		if (error)
			return callback(error);

		if (!releases || releases.length !== releaseNames.length)
			return callback(releaseNames
				.filter(releaseName => !releases.some(r => r.version === releaseName))
				.reduce(
					(acc, releaseName) => acc.addInfo(Entities.Release.name, releaseName),
					new SystemMessage(systemMessages.MISSING_RELEASES)));

		const result = {};

		for (const release of releases) {
			if (!release.artifacts || release.artifacts.length === 0) {
				logger.sysDEBUG(`Release ${release.version} has no artifacts.`);
				result[release.version] = {};
				continue;
			}

			const [err, baseVersionsByComponentNames] = extractVersionsFromArtifacts(release.artifacts, Object.values(consts.components));
			if (err)
				return callback(err);

			logger.sysDEBUG(`Version by component names for release ${release.version}:`, baseVersionsByComponentNames);
			result[release.version] = baseVersionsByComponentNames;
		}

		callback(null, result);
	});
};

// enrich the release versions with the component versions and compatibilities
// example input result: { '3.3.2-HF1': { 'nvmesh-client': '3.3.2' } }
// example result: { '3.3.2-HF1': { 'nvmesh-client': { ID: 9, version: '3.3.2', componentTypeID: 1, compatibilities: [{ ID: 1, componentTypeID: 1 }] } } }
const enrichVersionsForRelease = (releaseName, result, componentIdByName, callback) => {
	const queryObj = {
		filter: {
			componentID: { $in: Object.keys(result[releaseName]).map(n => componentIdByName[n]) },
			version: { $in: Object.values(result[releaseName]) }
		}
	};

	getAllComponentVersions(queryObj, (error, componentVersions) => {
		if (error)
			return callback(error);

		if (componentVersions.length === 0) {
			logger.sysDEBUG(`No component versions found for release ${releaseName}`);
			return callback();
		}

		const queryObjCompatibilitiesComponents = {
			filter: {
				ID: { $in: componentVersions.flatMap(cv => cv.compatibilities.map(c => c.ID)) }
			}
		};

		getAllComponentVersions(queryObjCompatibilitiesComponents, (error, components) => {
			if (error)
				return callback(error);

			const errors = [];

			for (const [componentName, version] of Object.entries(result[releaseName])) {
				const componentVersion = componentVersions.find(c => c.component.name === componentName && c.version === version);
				if (!componentVersion) {
					errors.push(new SystemMessage(systemMessages.COMPONENT_VERSION_NOT_FOUND)
						.addInfo(Entities.Component.name, componentName)
						.addInfo(Entities.Component.version, version));
					continue;
				}

				// add more details about components in compatibilities - componentTypeID
				componentVersion.compatibilities = componentVersion.compatibilities.map(c => ({
					...c,
					componentTypeID: components.find(component => component.ID === c.ID).component.componentTypeID
				}));

				result[releaseName][componentName] = componentVersion;
			}

			if (errors.length)
				return callback(errors.reduce(
					(acc, error) => acc.addInfo(Entities.Error, error),
					new SystemMessage(systemMessages.ENRICH_VERSIONS_FOR_RELEASE_FAILED)));

			logger.sysDEBUG(`Components by component names for release ${releaseName}:`, result[releaseName]);
			callback();
		});
	});
};

// fetch the components base versions for the release names and enrich the release versions with the component versions and compatibilities
// example result: { '3.3.2-HF1': { 'nvmesh-client': { ID: 9, version: '3.3.2', componentTypeID: 1, compatibilities: [{ ID: 1, componentTypeID: 1 }] } } }
const fetchAndEnrichVersionsForReleases = (releaseNames, releaseNamesToEnrich, componentIdByName, callback) => {
	fetchVersionsForReleases(releaseNames, (error, result) => {
		if (error)
			return callback(error);

		// filter the result to only include components that are in the componentIdByName
		for (const components of Object.values(result))
			for (const name of Object.keys(components))
				if (!Object.hasOwn(componentIdByName, name))
					delete components[name];

		async.eachSeries(
			releaseNamesToEnrich,
			(releaseName, cb) => enrichVersionsForRelease(releaseName, result, componentIdByName, cb),
			error => callback(error, result)
		);
	});
};

// prepare new components for the release n
// new component will be based on the release n-1 component if it exists, otherwise it will be created without inheritance
// inheritance will not include nvmesh package compatibilities as we will add them later (need to wait for components to be created)
const prepareNewComponents = (componentTypeIDbyName, componentIDbyName, versions, callback) => {
	const newComponents = [];

	for (const [componentName, version] of Object.entries(versions.n)) {
		const nMinus1Component = versions.nMinus1[componentName];
		if (!nMinus1Component)
			logger.sysDEBUG(`Component ${componentName} version ${version} not found in release n-1, creating without inheritance`);

		// create compatibilities without nvmesh package compatibilities for now, we will add the nvmesh package compatibilities later
		const compatibilities = nMinus1Component?.compatibilities
			.filter(c => c.componentTypeID !== componentTypeIDbyName[consts.componentTypes.NVMESH_PACKAGE])
			.map(c => ({ ID: c.dataValues.ID })) || [];

		const newComponent = {
			name: componentName,
			version: version,
			componentID: componentIDbyName[componentName],
			componentTypeID: componentTypeIDbyName[consts.componentTypes.NVMESH_PACKAGE],
			platforms: nMinus1Component?.platforms.map(platform => ({ ID: platform.ID })) || [],
			requirements: nMinus1Component?.requirements.map(requirement => ({ ID: requirement.ID })) || [],
			compatibilities
		};

		newComponents.push(newComponent);
	}

	logger.sysDEBUG('Prepared new components:', newComponents);
	callback(null, newComponents);
};

const createPreparedComponents = (newComponents, callback) => {
	createComponents(newComponents, responses =>
		handleCreationResponses(groupResponsesByStatus(responses, true), consts.entity.component, [Entities.Component.ID], callback));
};

// nvmesh package compatibilities are added to the n component versions based on the release n-1 component versions
// - if the component version does not exist in release n-1, we will skip the update
// - if the component version does not exist in release n, we will add the n-2 nvmesh package compatibility if it exists
const prepareNComponentVersions = (componentVersionsToUpdate, versions, mappedEntitiesIdsByName) => {
	const { componentTypeIDbyName, componentIDbyName, componentVersionIDbyName } = mappedEntitiesIdsByName;
	const errors = [];

	for (const componentVersion of componentVersionsToUpdate) {
		// handle missing component version in release n-1
		const nMinus1ComponentVersion = versions.nMinus1[componentVersion.component.name];
		if (!nMinus1ComponentVersion) {
			logger.sysDEBUG(`Component ${componentVersion.component.name} version ${componentVersion.version} not found in release n-1, skipping update`);
			continue;
		}

		// get the nvmesh package compatibilities for the release n-1 component
		const nMinus1NvmeshCompatibilities = nMinus1ComponentVersion.compatibilities
			.filter(c => c.componentTypeID === componentTypeIDbyName[consts.componentTypes.NVMESH_PACKAGE])
			.map(c => c.dataValues);

		// handle missing nvmesh package compatibilities in release n-1
		if (!nMinus1NvmeshCompatibilities.length) {
			logger.sysDEBUG(`Component ${componentVersion.component.name} version ${componentVersion.version} ` +
				'has no nvmesh package compatibilities in release n-1, skipping update');
			continue;
		}

		// group the nvmesh package compatibilities by component name
		const nMinus1compatibilitiesByComponentName = nMinus1NvmeshCompatibilities.reduce((acc, compatibility) => {
			const componentName = Object.keys(componentIDbyName).find(name => componentIDbyName[name] === compatibility.componentID);
			if (!acc[componentName])
				acc[componentName] = [];

			acc[componentName].push(compatibility);
			return acc;
		}, {});

		for (const [componentName, nMinus1Compatibilities] of Object.entries(nMinus1compatibilitiesByComponentName)) {
			// sort the nvmesh package compatibilities by version - will allow us to add the latest compatibility first
			const nMinus1sortedCompatibilities = [...nMinus1Compatibilities].sort((a, b) => compareVersionRelease(a.version, b.version));
			const newCompatibilities = [];

			// add the n-1 nvmesh package compatibility (latest version)
			newCompatibilities.push(nMinus1sortedCompatibilities.pop());

			// get the version for the component in release n - i.e. '3.3.2'
			const version = versions.n[componentName]?.version;

			if (version) {
				// add the n nvmesh package compatibility if it exists
				const componentVersionID = componentVersionIDbyName[`${componentName} - ${version}`];
				if (!componentVersionID) {
					errors.push(new SystemMessage(systemMessages.COMPONENT_VERSION_NOT_FOUND_IN_NEWLY_CREATED_COMPONENTS)
						.addInfo(Entities.Component.name, componentName)
						.addInfo(Entities.Component.version, version));
					continue;
				}

				newCompatibilities.push({ ID: componentVersionID });
			} else {
				// add the n-2 nvmesh package compatibility if it exists
				const nMinus2ComponentVersion = nMinus1sortedCompatibilities.pop();
				if (nMinus2ComponentVersion)
					newCompatibilities.push(nMinus2ComponentVersion);
				else
					logger.sysDEBUG(`Component ${componentName} version ${version} not found in n-2 component`);
			}

			logger.sysDEBUG(`Adding new compatibilities to component ${componentName} version ${componentVersion.version}:`, newCompatibilities);
			componentVersion.compatibilities.push(...newCompatibilities);
		}
	}

	const error = errors.length
		? errors.reduce((acc, error) => acc.addInfo(Entities.Error, error),
			new SystemMessage(systemMessages.ADD_NVMESH_PACKAGE_COMPATIBILITIES_FAILED))
		: undefined;

	return [error, componentVersionsToUpdate];
};

// nvmesh packages component versions from nMinus1 release are updated to be compatible with nvmesh
// packages component versions from n release (only if they exist already)
const prepareNMinus1ComponentVersions = (componentVersionsToUpdate, versions, mappedEntitiesIdsByName) => {
	const { componentTypeIDbyName, componentIDbyName } = mappedEntitiesIdsByName;

	for (const nMinus1ComponentVersion of componentVersionsToUpdate) {
		const componentName = nMinus1ComponentVersion.component.name;
		const newCompatibilities = [];

		// get the nvmesh package compatibilities for the release n-1 component
		const nMinus1NvmeshCompatibilities = versions.nMinus1?.[componentName]?.compatibilities
			?.filter(c => c.componentTypeID === componentTypeIDbyName[consts.componentTypes.NVMESH_PACKAGE])
			?.map(c => c.dataValues);

		// handle missing nvmesh package compatibilities in release n-1
		if (!nMinus1NvmeshCompatibilities?.length) {
			logger.sysDEBUG(`Component ${componentName} version ${nMinus1ComponentVersion.version} has no nvmesh package compatibilities, skipping update`);
			continue;
		}

		const getComponentNameByComponentID = componentID => Object.keys(componentIDbyName).find(name => componentIDbyName[name] === componentID);
		const componentNameAlreadyAdded = new Set();

		for (const nMinus1NvmeshCompatibility of nMinus1NvmeshCompatibilities) {
			const nComponentID = nMinus1NvmeshCompatibility.componentID;
			const nComponentName = getComponentNameByComponentID(nComponentID);

			// handle missing n component
			if (!nComponentName) {
				logger.sysDEBUG(`N component ID ${nComponentID} not found in componentIDbyName, skipping update`);
				continue;
			}

			// handle already added n component
			if (componentNameAlreadyAdded.has(nComponentName)) {
				logger.sysDEBUG(`N component ${nComponentName} already added, skipping update`);
				continue;
			}

			// handle missing n component version
			const nComponentVersion = versions.n[nComponentName];
			if (!nComponentVersion) {
				logger.sysDEBUG(`Component ${nComponentName} version ${nMinus1NvmeshCompatibility.version} not found in release n, skipping update`);
				continue;
			}

			componentNameAlreadyAdded.add(nComponentName);
			newCompatibilities.push({ ID: nComponentVersion.ID });
		}

		logger.sysDEBUG(`Adding new compatibilities to component ${componentName} version ${nMinus1ComponentVersion.version}:`, newCompatibilities);
		nMinus1ComponentVersion.compatibilities.push(...newCompatibilities);
	}

	return componentVersionsToUpdate;
};

// at this point all components are created, we can update the nvmesh package compatibilities
const updateCompatibilities = (createdResponses, versions, componentIDbyName, componentTypeIDbyName, callback) => {
	const createdIDs = createdResponses.map(response => response.getAdditionalInfoByKey(Entities.Component.ID));
	const nMinus1ComponentVersionIDs = Object.values(versions.nMinus1).map(componentVersion => componentVersion.ID);
	const allComponentVersionIDs = [...createdIDs, ...nMinus1ComponentVersionIDs];
	if (!allComponentVersionIDs.length)
		return callback();

	getAllComponentVersions({ filter: { ID: { $in: allComponentVersionIDs } } }, (error, componentVersions) => {
		if (error)
			return callback(error);

		const componentVersionIDbyName = mapEntityIdsByName(componentVersions, c => `${c.component.name} - ${c.version}`);
		const mappedEntitiesIdsByName = { componentTypeIDbyName, componentIDbyName, componentVersionIDbyName };

		const [nError, nComponentVersionsToUpdate] = prepareNComponentVersions(
			componentVersions.filter(cv => createdIDs.includes(cv.ID)),
			versions,
			mappedEntitiesIdsByName
		);
		if (nError)
			return callback(nError);

		const nMinus1ComponentVersionsToUpdate = prepareNMinus1ComponentVersions(
			componentVersions.filter(cv => nMinus1ComponentVersionIDs.includes(cv.ID)),
			versions,
			mappedEntitiesIdsByName
		);
		const componentVersionsToUpdate = [...nComponentVersionsToUpdate, ...nMinus1ComponentVersionsToUpdate];

		updateComponents(componentVersionsToUpdate, responses =>
			handleUpdateResponses(responses, systemMessages.FAILED_TO_UPDATE_COMPONENTS, callback));
	});
};

// {
// 	componentTypeIDbyName: { 'nvmesh-client': 1 },
// 	componentIDbyName: { 'nvmesh-client': 9 },
// 	versions: {
// 		'3.3.3': { 'nvmesh-client': '3.3.3' },
// 		'3.3.2': { 'nvmesh-client': { ID: 9, version: '3.3.2', componentTypeID: 1, compatibilities: [{ ID: 1, componentTypeID: 1 }] } }
// 	}
// }
const fetchInheritComponentsData = (releaseN, releaseNMinus1, callback) => {
	async.parallel({
		componentTypeIDbyName: fetchComponentTypeIdsByName,
		componentIDbyName: cb => fetchComponentIdsByName({ filter: { name: { $in: Object.values(consts.components) } } }, false, cb)
	}, (error, data) => {
		if (error)
			return callback(error);

		fetchAndEnrichVersionsForReleases([releaseN, releaseNMinus1], [releaseNMinus1], data.componentIDbyName, (error, versions) => {
			if (error)
				return callback(error);

			data.versions = { n: versions[releaseN], nMinus1: versions[releaseNMinus1] };

			logger.sysDEBUG('Fetched components data:', data);
			callback(null, data);
		});
	});
};

const inheritComponents = (releaseN, releaseNMinus1, callback) => {
	let data;
	logger.sysDEBUG(`Inheriting components from release ${releaseNMinus1} to release ${releaseN}`);

	async.waterfall([
		cb => fetchInheritComponentsData(releaseN, releaseNMinus1, cb),
		(fetchedData, cb) => {
			data = fetchedData;
			prepareNewComponents(data.componentTypeIDbyName, data.componentIDbyName, data.versions, cb);
		},
		(newComponents, cb) => createPreparedComponents(newComponents, cb),
		(createdResponses, cb) => enrichVersionsForRelease(releaseN, { [releaseN]: data.versions.n }, data.componentIDbyName, err => cb(err, createdResponses)),
		(createdResponses, cb) => updateCompatibilities(createdResponses, data.versions, data.componentIDbyName, data.componentTypeIDbyName, cb)
	], callback);
};

// prepare upgrade scenarios for the release n based on the release n-1
// if the release is a hotfix, we will copy all upgrade scenarios with * -> n-1 to * -> n
// otherwise, we will copy all upgrade scenarios with n-1 -> n-1 to n-1 -> n and n -> n
const prepareUpgradeScenarios = (releaseN, releaseNMinus1, versions, upgradeTypesIDByName, releaseIDbyName, callback) => {
	logger.sysDEBUG(`Preparing upgrade scenarios for release ${releaseN}`);

	const isHotfix = releaseN.includes(consts.HOTFIX_RELEASE_SUBSTRING);
	if (isHotfix)
		logger.sysDEBUG(`Release ${releaseN} is a hotfix release`);


	const upgradeTypesByComponentName = {
		[consts.components.CLIENT]: [upgradeTypesIDByName[consts.upgradeTypes.CLIENT_AND_TARGET], upgradeTypesIDByName[consts.upgradeTypes.CLIENT_ONLY]],
		[consts.components.MANAGEMENT]: [upgradeTypesIDByName[consts.upgradeTypes.MANAGEMENT]],
		[consts.components.UPGRADE_AGENT]: [upgradeTypesIDByName[consts.upgradeTypes.UPGRADE_AGENT]]
	};


	const preparedUpgradeScenarios = [];
	async.eachSeries(Object.keys(upgradeTypesByComponentName), (componentName, cb) => {
		const queryObj = {
			filter: {
				destinationReleaseID: releaseIDbyName[releaseNMinus1],
				upgradeTypeID: { $in: upgradeTypesByComponentName[componentName] }
			}
		};

		if (!isHotfix) {
			if (!versions[releaseNMinus1][componentName])
				return cb(new SystemMessage(systemMessages.COMPONENT_VERSION_NOT_FOUND_IN_RELEASE)
					.addInfo(Entities.Component.name, componentName)
					.addInfo(Entities.Release.name, releaseNMinus1));

			queryObj.filter['componentVersion.version'] = versions[releaseNMinus1][componentName].version;
		}

		logger.sysDEBUG(`Getting upgrade scenarios to copy from release ${releaseNMinus1} to release ${releaseN} for component ${componentName}:`, queryObj);

		getAllUpgrades(queryObj, (error, upgradeScenariosFound) => {
			if (error)
				return callback(error);

			const upgradeScenarios = [];
			for (const upgradeScenarioFound of upgradeScenariosFound) {
				if (isHotfix)
					upgradeScenarios.push({
						sourceVersionID: upgradeScenarioFound.sourceVersionID,
						destinationReleaseID: releaseIDbyName[releaseN],
						upgradeTypeID: upgradeScenarioFound.upgradeTypeID,
						steps: upgradeScenarioFound.steps
					});
				else
					for (const releaseName of [releaseNMinus1, releaseN]) {
						upgradeScenarios.push({
							sourceVersionID: versions[releaseName][componentName].ID,
							destinationReleaseID: releaseIDbyName[releaseN],
							upgradeTypeID: upgradeScenarioFound.upgradeTypeID,
							steps: upgradeScenarioFound.steps
						});
					}
			}

			preparedUpgradeScenarios.push(...upgradeScenarios);
			cb();
		});
	}, error => {
		if (error)
			return callback(error);

		logger.sysDEBUG(`Upgrade scenarios to copy from release ${releaseNMinus1} to release ${releaseN}:`, preparedUpgradeScenarios);
		callback(null, preparedUpgradeScenarios);
	});
};

const createPreparedUpgradeScenarios = (upgradeScenarios, callback) => {
	createUpgrades(upgradeScenarios, responses =>
		handleCreationResponses(groupResponsesByStatus(responses, true), consts.entity.upgradeScenario, [Entities.UpgradeScenario.ID], callback));
};

const fetchDataForUpgradeScenariosInheritance = (releaseN, releaseNMinus1, callback) => {
	const componentNames = [consts.components.CLIENT, consts.components.MANAGEMENT, consts.components.UPGRADE_AGENT];

	async.parallel({
		upgradeTypesIDByName: fetchUpgradeTypeIdsByName,
		componentIDbyName: cb => fetchComponentIdsByName({ filter: { name: { $in: componentNames } } }, false, cb),
		releaseIDbyName: cb => fetchReleaseIdsByName({ filter: { version: { $in: [releaseN, releaseNMinus1] } } }, cb),
	}, (error, data) => {
		if (error)
			return callback(error);

		fetchAndEnrichVersionsForReleases([releaseN, releaseNMinus1], [releaseN, releaseNMinus1], data.componentIDbyName, (error, versions) => {
			if (error)
				return callback(error);

			data.versions = versions;

			logger.sysDEBUG('Fetched upgrade scenarios data:', data);
			callback(null, data);
		});
	});
};

const updateUpgradeScenarios = (createdResponses, preparedUpgradeScenarios, callback) => {
	const createdIDs = createdResponses.map(response => response.getAdditionalInfoByKey(Entities.UpgradeScenario.ID));
	if (!createdIDs.length)
		return callback();

	getAllUpgrades({ filter: { ID: { $in: createdIDs } } }, (error, createdUpgradeScenarios) => {
		if (error)
			return callback(error);

		const errors = [];

		for (const createdUpgradeScenario of createdUpgradeScenarios) {
			const preparedUpgradeScenario = preparedUpgradeScenarios.find(scenario =>
				scenario.sourceVersionID === createdUpgradeScenario.sourceVersionID &&
				scenario.destinationReleaseID === createdUpgradeScenario.destinationReleaseID &&
				scenario.upgradeTypeID === createdUpgradeScenario.upgradeTypeID);

			if (!preparedUpgradeScenario) {
				errors.push(new SystemMessage(systemMessages.PREPARED_UPGRADE_SCENARIO_NOT_FOUND)
					.addInfo(Entities.UpgradeScenario.ID, createdUpgradeScenario.ID)
					.addInfo(Entities.UpgradeScenario.sourceVersion, createdUpgradeScenario.sourceVersion)
					.addInfo(Entities.UpgradeScenario.destinationRelease, createdUpgradeScenario.destinationRelease)
					.addInfo(Entities.UpgradeScenario.upgradeType, createdUpgradeScenario.upgradeType));
				continue;
			}

			preparedUpgradeScenario.ID = createdUpgradeScenario.ID;
		}

		if (errors.length)
			return callback(errors.reduce((acc, error) => acc.addInfo(Entities.Error, error),
				new SystemMessage(systemMessages.FAILED_TO_PREPARE_UPGRADE_SCENARIOS_FOR_UPDATE)));

		updateUpgrades(preparedUpgradeScenarios, responses =>
			handleUpdateResponses(responses, systemMessages.FAILED_TO_UPDATE_UPGRADE_SCENARIOS, callback));
	});
};

const inheritUpgradeScenarios = (releaseN, releaseNMinus1, callback) => {
	logger.sysDEBUG(`Inheriting upgrade scenarios from release ${releaseNMinus1} to release ${releaseN}`);
	let upgradeScenarios;

	async.waterfall([
		cb => fetchDataForUpgradeScenariosInheritance(releaseN, releaseNMinus1, cb),
		(data, cb) => prepareUpgradeScenarios(releaseN, releaseNMinus1, data.versions, data.upgradeTypesIDByName, data.releaseIDbyName, cb),
		(preparedUpgradeScenarios, cb) => {
			upgradeScenarios = preparedUpgradeScenarios;

			// create upgrade scenarios without steps as API does not support steps creation
			// eslint-disable-next-line no-unused-vars
			createPreparedUpgradeScenarios(upgradeScenarios.map(({ steps, ...scenarioToCreate }) => scenarioToCreate), cb);
		},
		(createdResponses, cb) => updateUpgradeScenarios(createdResponses, upgradeScenarios, cb),
	], callback);
};

scope.saveReleases = (payload, cb) => {
	const messages = [];

	async.eachSeries(payload, (release, cb) => {
		saveRelease(release, message => {
			messages.push(message);
			cb();
		});
	}, () => cb(messages));
};

const saveRelease = (payload, callback) => {
	async.series([
		// create platforms and dependencies
		cb => {
			if (!payload.createPlatforms)
				return cb();

			createPlatformsAndDependencies(payload.platforms.filter(platform => platform.name), cb);
		},
		// create artifacts and link them to platforms
		cb => createEntities(payload.platforms, prepareArtifacts, createArtifacts, handleArtifactsResponses, cb),
		// create/update release and link artifacts to it
		cb => {
			const { releaseName, platforms } = payload;
			const artifacts = getUniqueStrings(platforms.flatMap(platform => platform.artifacts), 'artifacts');

			createOrUpdateRelease(releaseName, artifacts, cb);
		},
		// inherit components
		cb => {
			if (!payload.inheritRelationsFrom)
				return cb();

			inheritComponents(payload.releaseName, payload.inheritRelationsFrom, cb);
		},
		// inherit upgrade scenarios
		cb => {
			if (!payload.inheritRelationsFrom)
				return cb();

			inheritUpgradeScenarios(payload.releaseName, payload.inheritRelationsFrom, cb);
		},
	], error => {
		const message = (error ?
			new SystemAdminMessage(systemMessages.SAVE_RELEASE_FAILED).addInfo(Entities.Error, error) :
			new SystemAdminMessage(systemMessages.SAVE_RELEASE_SUCCESS)
		).addInfo(Entities.Release.name, payload.releaseName);

		callback(message);
	});
};

module.exports = scope;
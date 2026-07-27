/* global React */
import { getConfigProfileVersion } from '../../utils.js';

const ConfigProfileView = ({
	configProfile = {},
	desiredConfigProfile = null,
	restartRequired = false,
}) => {
	let restartRequiredTitle = 'Restart required';
	if (desiredConfigProfile)
		restartRequiredTitle += ` to apply ${desiredConfigProfile.name}(${desiredConfigProfile.version})`;
	const userOverriedTitle = 'nvmesh.conf was modified by the user';
	return (<>
		{restartRequired && <span className="ion-alert-circled yellow table-icon" title={restartRequiredTitle}></span>}
		{configProfile?.userOverride && <span className="fa fa-info-circle" title={userOverriedTitle}></span>}
		<span title={getConfigProfileVersion(configProfile)}>{getConfigProfileVersion(configProfile, true)}</span>
	</>);
};

export default ConfigProfileView;
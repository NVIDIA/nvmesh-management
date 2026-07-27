/* global React, ReactHookForm */

import FormControl from '../../../core/FormControl.jsx';
import Select from '../../../core/Select.jsx';

const { Controller } = ReactHookForm;

const VolumeClassLimiters = ({
	control,
	volume,
	disabled,
	loadDisks,
	targetClasses,
	diskClasses,
	domains,
	formPath
}) => {
	const getFieldName = (name) => formPath ? `${formPath}.${name}` : name;

	return (
		<>
			<FormControl
				name={getFieldName('serverClasses')}
				label="Target Classes"
				className="form-group-md"
			>
				<Controller
					control={control}
					name={getFieldName('serverClasses')}
					value={volume?.serverClasses}
					render={({ field: { onChange, value } }) => (
						<Select id={getFieldName('serverClasses')}
						        placeholder="Choose Target Classes"
						        value={value}
						        onChange={value => {
							        onChange(value);
							        loadDisks({ serverClasses: value });
						        }}
						        valueField="_id"
						        labelField="_id"
						        searchField="_id"
						        multiple
						        options={targetClasses}
						/>
					)}
				/>
			</FormControl>

			<FormControl
				name={getFieldName('diskClasses')}
				label="Drive Classes"
				className="form-group-md"
			>
				<Controller
					control={control}
					name={getFieldName('diskClasses')}
					value={volume?.diskClasses}
					render={({ field: { onChange, value } }) => (
						<Select
							id={getFieldName('diskClasses')}
							placeholder="Choose Drive Classes"
							value={value}
							onChange={value => {
								onChange(value);

								if (loadDisks) {
									loadDisks({ diskClasses: value });
								}
							}}
							valueField="_id"
							labelField="_id"
							searchField="_id"
							multiple
							options={diskClasses}
						/>
					)}
				/>
			</FormControl>

			<FormControl
				name={getFieldName('domain')}
				label="Protection Domain"
				className="form-group-md"
			>
				<Controller
					control={control}
					name={getFieldName('domain')}
					value={volume?.domain}
					render={({ field: { onChange, value } }) => (
						<Select
							id={getFieldName('domain')}
							placeholder="Choose Protection Domain scope"
							value={value}
							onChange={onChange}
							disabled={disabled}
							options={domains.map(domain => ({ text: domain, value: domain }))}
						/>
					)}
				/>
			</FormControl>
		</>
	);
};

export default VolumeClassLimiters;
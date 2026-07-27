/* global React */

import FormControl from '../core/FormControl.jsx';
import Select from '../core/Select.jsx';

const { useMemo } = React;

const DomainsSelect = ({
	domains = [],
	selectedDomains = [],
	// eslint-disable-next-line no-unused-vars
	onChange = _ => {},
	placeholder = 'Choose protection domains, or type a new one in the following format: <scope:identifier>',
}) => {
	const validateName = (name) => /^[\w \-_]{1,32}:[\w \-_]{1,32}$/.test(name);

	const create = value => {
		if (!validateName(value)) {
			return false;
		}
		return { value: value, text: value };
	};

	const createFilter = value => {
		if (!validateName(value)) {
			return false;
		}
		return { value: value, text: value };
	};

	const handleChange = (selected) => {
		const domainObjects = selected.map((domain) => {
			const [scope, identifier] = domain.split(':');
			return { scope, identifier };
		});

		onChange(domainObjects);
	};

	return (
		<FormControl label="Protection Domains"
		             name="domains">
			<Select id="domains"
			        create={create}
			        createFilter={createFilter}
			        placeholder={placeholder}
			        value={selectedDomains.map((d) => `${d.scope}:${d.identifier}`)}
			        multiple
			        onChange={value => handleChange(value)}
			        options={useMemo(() => domains.map((domain) => ({ text: domain, value: domain })), [domains])}
			/>
		</FormControl>
	);
};

export default DomainsSelect;

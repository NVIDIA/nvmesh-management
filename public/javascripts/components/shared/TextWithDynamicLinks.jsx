/* global React, consts */

const TextWithDynamicLinks = ({
	textTemplate = '',
	links = {},
}) => {
	let resolvedMsg = textTemplate;

	Object.entries(links).forEach(([key, value]) => {
		const link = consts.getEntityLink(value);
		const htmlLink = `<a href="${link}">${value.entityText}</a>`;
		resolvedMsg = resolvedMsg.replace(`{${key}}`, htmlLink);
	});

	return <span dangerouslySetInnerHTML={{ __html: resolvedMsg }}/>;
};

export default TextWithDynamicLinks;

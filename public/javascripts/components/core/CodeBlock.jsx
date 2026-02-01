/* global React */

const CodeBlock = ({ code }) => {
	return (
		<pre>
			<code className="language-bash">{code}</code>
		</pre>
	);
};

export default CodeBlock;

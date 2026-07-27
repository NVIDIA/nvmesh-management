/* global React */

const NewButton = ({ onClick, disabled }) => {
	return (
		<div className="fab"
		     onClick={onClick}
		     disabled={disabled}>
			<i className="fa fa-plus"></i>
		</div>
	);
};

export default NewButton;
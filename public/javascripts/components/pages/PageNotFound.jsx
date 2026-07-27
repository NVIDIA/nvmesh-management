/* global React */

const PageNotFound = () => {

	return (
		<div className="container">
			<div className="text-center page-not-found">
				<i className="fa fa-frown-o"></i>
				<div className="err-code">404</div>
				<div className="err-text">Page not found</div>
			</div>
		</div>
	);
};

export default PageNotFound;
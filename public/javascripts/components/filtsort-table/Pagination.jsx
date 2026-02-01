/* global React */

export const PagingSummary = ({
	currentPage,
	count,
	total,
}) => {

	return (
		<span className="paging-summery pagination">
			{total && ((currentPage - 1) * count + 1)} - {Math.min((currentPage) * count, total)} of {total}
		</span>
	);
};

export const Pagination = ({
	currentPage,
	totalPages,
	onPageChange,
}) => {
	const handlePageChange = (newPage) => {
		if (newPage < 1 || newPage > totalPages) return;

		onPageChange(newPage);
	};

	return (
		<ul className="pagination">
			<li className={'prev ' + (currentPage === 1 ? 'disabled' : '')}
				onClick={() => handlePageChange(currentPage - 1)}>
				<a className="page-link">&lt;</a>
			</li>
			<li className={'next ' + (currentPage === totalPages ? 'disabled' : '')}
				onClick={() => handlePageChange(currentPage + 1)}>
				<a className="page-link">&gt;</a>
			</li>
		</ul>
	);
};

export const ItemsPerPage = ({
	itemsPerPage,
	itemsPerPageOptions,
	handleItemsPerPageChange
}) => {
	return (
		<items-per-page>
			<select
				value={itemsPerPage}
				onChange={e => handleItemsPerPageChange(e.target.value)}
				className="pagination-select"
			>
				{itemsPerPageOptions.map((option) => (
					<option key={option} value={option}>
						{option}
					</option>
				))}
			</select>
		</items-per-page>
	);
};
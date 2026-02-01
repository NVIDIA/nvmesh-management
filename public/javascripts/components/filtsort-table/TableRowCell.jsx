/* global React, moment */

import { getProperty } from '../utils.js';

export const TableRowCell = ({
	col,
	row
}) => {
	const value = col.field && getProperty(row, col.field);
	let cellValue;

	if (col.value) {
		cellValue = col.value(row);
	} else if (col.type === 'boolean') {
		cellValue = value && <i className="ion-checkmark-round"/>;
	} else if (col.type === 'dateRange') {
		cellValue = value && moment(value).format('MM/DD/YYYY [at] H:mm:ss');
	} else {
		cellValue = value;
	}

	return <td column-name={col.name} className={col.rowClassName}>
		{cellValue}
	</td>;
};
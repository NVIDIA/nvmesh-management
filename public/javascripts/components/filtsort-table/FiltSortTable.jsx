/* global React, ReactDOM, consts, $ */

import { filtsort } from './filtsort.js';
import Modal from '../core/Modal.jsx';
import VisibleColumnsTable from './VisibleColumns.jsx';
import { ItemsPerPage, Pagination, PagingSummary } from './Pagination.jsx';
import { TableRowCell } from './TableRowCell.jsx';
import Checkbox from '../core/Checkbox.jsx';
import { TableHeadCell } from './TableHeadCell.jsx';
import useQueryParams from '../useQueryParams.hook.js';
import { tableSettingsService } from '../services/table-settings.service.js';
import { getProperty, keyBy } from '../utils.js';

const {
	useState,
	useRef,
	useEffect,
	useMemo,
	forwardRef,
	useImperativeHandle
} = React;

let isShiftPressed = false;

$(document).on('keydown', event => {
	if (event.which === consts.SHIFT_KEY_CODE) {
		isShiftPressed = true;
	}
});

$(document).on('keyup', event => {
	if (event.which === consts.SHIFT_KEY_CODE) {
		isShiftPressed = false;
	}
});

function calcColumnsToShow(columns, visibleOrderedColumns) {
	const columnsByName = columns.reduce((res, col) => {
		res[col.name] = col;
		return res;
	}, {});

	return visibleOrderedColumns.map(colName => {
		if (!columnsByName[colName]) {
			throw new Error(`column name not found ${colName}`);
		}
		return columnsByName[colName];
	});
}

const MemoizedPagination = React.memo(Pagination);
const MemoizedPagingSummary = React.memo(PagingSummary);
const MemoizedItemsPerPage = React.memo(ItemsPerPage);
const MemoizedTableRowCell = React.memo(TableRowCell);
const MemoizedTableHeadCell = React.memo(TableHeadCell);

const FiltSortTable = forwardRef(function FiltSortTable({
	tableId,
	columns,
	loadRows,
	loadTotal,
	rowIdentifier = '_id',
	paginationDisabled = false,
	defaultCount = consts.filtSortTable.defaultCount,
	itemsPerPageOptions = consts.filtSortTable.itemsPerPageOptions,
	queryParamsEnabled = true,
	multiselectOptions = {},
	tableSettingsCache = {
		enabled: true,
		getSettings: tableSettingsService.getTableSettings,
		setSettings: tableSettingsService.setTableSettings
	}
}, ref) {
	const { getQueryParam, setQueryParam } = useQueryParams();
	const tableRef = useRef(null);
	const filterSortTable = useRef(null);
	const allCheckboxRef = useRef(null);
	const skipSelectedRowsEvent = useRef(true); // we want to skip the initial empty value
	const [rows, setRows] = useState([]);
	const [filter, setFilter] = useState(() => (queryParamsEnabled && getQueryParam('filter')) || {});
	const [sort, setSort] = useState(() => (queryParamsEnabled && getQueryParam('sort')) || {});
	const [currentPage, setCurrentPage] = useState(1);
	const [count, setCount] = useState(() => {
		if (tableSettingsCache.enabled) {
			const settings = tableSettingsCache.getSettings(tableId);
			return settings.defaultCount || defaultCount;
		}
		return defaultCount;
	});
	const [total, setTotal] = useState(0);
	const totalPages = Math.ceil(total / count);
	const [showVisibleColsModal, setShowVisibleColsModal] = useState(false);
	const [selectedVisibleColumns, setSelectedVisibleColumns] = useState(
		() => columns.filter(col => !col.hiddenByDefault).map(col => col.name)
	);

	// multiselect table
	const [selectedRows, setSelectedRows] = useState({});
	const [lastFocusedIndex, setLastFocusedIndex] = useState(null);

	const getSelectedFilter = (selectedRows) => ({ [rowIdentifier]: { $in: selectedRows.map(row => getProperty(row, rowIdentifier)) } });
	const [selectedFilter, setSelectedFilter] = useState(null);

	let visibleOrderedColumns = selectedVisibleColumns;
	if (tableSettingsCache.enabled) {
		const settings = tableSettingsCache.getSettings(tableId);
		if (settings.visibleOrderedColumns) {
			visibleOrderedColumns = settings.visibleOrderedColumns;
		}
	}

	useImperativeHandle(ref, () => ({
		reloadRows: reloadRows,
		reloadTotal: reloadTotal,
		updateRow: (id, newRowData) => {
			const rowIndex = rows.findIndex(currRow => getProperty(currRow, rowIdentifier) === id);
			if (rowIndex !== -1) {
				setRows(prevRows => {
					const newRows = [...prevRows];
					newRows[rowIndex] = { ...newRows[rowIndex], ...newRowData };
					return newRows;
				});
			}
		},
		clearSelectedRows: () => setSelectedRows({})
	}));

	const reloadRows = async(deselectMissingRows = true) => {
		const requestFilter = {
			...filter,
			...(selectedFilter || {})
		};
		// page is zero-based
		const rows = await loadRows(requestFilter, sort, currentPage - 1, count);

		// if page is empty, go to previous page
		if (!rows.length && currentPage > 1) {
			setCurrentPage(currentPage - 1);
		} else {
			setRows(rows);
		}

		if (deselectMissingRows) {
			// deselect rows that no longer exist in the page
			setSelectedRows((prevSelectedRows) => {
				const existingRowIds = new Set(rows.map(row => getProperty(row, rowIdentifier)));
				return Object.values(prevSelectedRows).reduce((newSelectedRows, row) => {
					const id = getProperty(row, rowIdentifier);
					if (existingRowIds.has(id)) {
						newSelectedRows[id] = prevSelectedRows[id];
					}
					return newSelectedRows;
				}, {});
			});
		}
	};

	const reloadTotal = async() => {
		const requestFilter = {
			...filter,
			...(selectedFilter || {})
		};
		const totalRes = await loadTotal(requestFilter);
		setTotal(totalRes);
	};

	const columnsToShow = useMemo(() => {
		try {
			return calcColumnsToShow(columns, visibleOrderedColumns);
		} catch (e) {
			if (tableSettingsCache.enabled) {
				// columns order settings is malformed, clearing it
				const settings = tableSettingsCache.getSettings(tableId);
				console.warn(`malformed columns settings: ${e}`, settings.visibleOrderedColumns);
				delete settings.visibleOrderedColumns;
				tableSettingsCache.setSettings(tableId, settings);
			}
			return columns;
		}
	}, [columns, visibleOrderedColumns, tableSettingsCache, tableId]);

	useEffect(() => {
		filterSortTable.current = filtsort({
			table: tableRef.current,
			filter,
			sort,
			isMultiselect: multiselectOptions?.enabled,
			onFilterChange: filter => {
				setFilter(filter);
				setCurrentPage(1);

				if (queryParamsEnabled) setQueryParam('filter', filter);
			},
			onSortChange: sort => {
				setSort(sort);
				setCurrentPage(1);

				if (queryParamsEnabled) setQueryParam('sort', sort);
			},
			onColumnsReorder: columns => {
				if (!tableSettingsCache.enabled) return;

				visibleOrderedColumns = columns;
				const settings = tableSettingsCache.getSettings(tableId);
				settings.visibleOrderedColumns = visibleOrderedColumns;
				tableSettingsCache.setSettings(tableId, settings);
			},
			onReady: (initialSort) => {
				if (multiselectOptions?.enabled) {
					const $allCheckboxCell = $('#all-checkbox-cell');
					allCheckboxRef.current = $allCheckboxCell[0];
				}

				if (!$.isEmptyObject(initialSort)) {
					setSort(initialSort);
				}
			}
		});

	}, []);

	// render filtsort row after hide/show columns
	useEffect(() => {
		filterSortTable.current.renderFiltSort();
	}, [selectedVisibleColumns]);

	useEffect(() => {
		reloadTotal();
		reloadRows(false);
	}, [currentPage, count, sort, filter, selectedFilter]);

	// multiselect table
	const multiSelectState = useMemo(() => {
		if (!multiselectOptions?.enabled) {
			return {
				isSelectedAll: false,
				isIndeterminate: false,
			};
		}

		const allSelected = rows.length && rows.every((row) => selectedRows[getProperty(row, rowIdentifier)]);
		const anySelected = rows.some((row) => selectedRows[getProperty(row, rowIdentifier)]);

		return {
			isSelectedAll: allSelected,
			isIndeterminate: !allSelected && anySelected,
		};
	}, [rows, selectedRows, multiselectOptions?.enabled]);

	const { isSelectedAll, isIndeterminate } = multiSelectState;

	// order of effects is important!
	useEffect(() => {
		// Do not trigger onSelectedRowsChange if the event is skipped
		if (skipSelectedRowsEvent.current) {
			skipSelectedRowsEvent.current = false;
			return;
		}

		if (multiselectOptions?.onSelectedRowsChange) {
			multiselectOptions.onSelectedRowsChange(Object.values(selectedRows));
		}
	}, [selectedRows]);

	useEffect(() => {
		if (multiselectOptions?.isViewSelectedEnabled) {
			setSelectedFilter(prev => prev && getSelectedFilter(Object.values(selectedRows)));
		}
	}, [selectedRows]);

	useEffect(() => {
		if (multiselectOptions?.initiallySelectedRows) {
			const selectedRowsById = keyBy(multiselectOptions.initiallySelectedRows, row => getProperty(row, rowIdentifier));
			setSelectedRows(selectedRowsById);
			skipSelectedRowsEvent.current = true;
		}
	}, []);

	const onRangeSelected = (row, rowIndex, isSelected) => {
		const [start, end] = [
			Math.min(lastFocusedIndex, rowIndex),
			Math.max(lastFocusedIndex, rowIndex),
		];
		const newSelected = { ...selectedRows };

		for (let i = start; i <= end; i++) {
			const currentRow = rows[i];
			if (multiselectOptions?.rowSelectionDisabled?.(currentRow)) continue;

			if (isSelected) {
				newSelected[getProperty(currentRow, rowIdentifier)] = currentRow;
			} else {
				delete newSelected[getProperty(currentRow, rowIdentifier)];
			}
		}
		setSelectedRows({ ...newSelected });
	};

	const onRowSelected = (row, rowIndex, isSelected) => {
		setLastFocusedIndex(rowIndex); // Update last focused row

		if (isShiftPressed && lastFocusedIndex !== null) {
			onRangeSelected(row, rowIndex, isSelected);
			return;
		}

		setSelectedRows((prevSelectedRows) => {
			const newSelectedRows = { ...prevSelectedRows };
			if (isSelected) {
				newSelectedRows[getProperty(row, rowIdentifier)] = row;
			} else {
				delete newSelectedRows[getProperty(row, rowIdentifier)];
			}
			return newSelectedRows;
		});
	};

	const onAllRowsSelected = (isSelected) => {
		setSelectedRows((prevSelectedRows) => {
			const newSelectedRows = { ...prevSelectedRows };
			rows.forEach(row => {
				if (multiselectOptions?.rowSelectionDisabled?.(row)) return;

				if (!isSelected || isIndeterminate) {
					delete newSelectedRows[getProperty(row, rowIdentifier)];
				} else {
					newSelectedRows[getProperty(row, rowIdentifier)] = row;
				}
			});
			return newSelectedRows;
		});
	};

	const onItemsPerPageChange = newPageSize => {
		const newCount = parseInt(newPageSize);
		setCount(newCount);
		setCurrentPage(1);

		if (tableSettingsCache.enabled) {
			const settings = tableSettingsCache.getSettings(tableId);
			settings.defaultCount = newCount;
			tableSettingsCache.setSettings(tableId, settings);
		}
	};

	const onVisibleColumnsChange = selectedColumns => {
		visibleOrderedColumns = selectedColumns;

		if (tableSettingsCache.enabled) {
			const settings = tableSettingsCache.getSettings(tableId);
			settings.visibleOrderedColumns = selectedColumns;
			tableSettingsCache.setSettings(tableId, settings);
		}

		setSelectedVisibleColumns(selectedColumns);
	};

	const onToggleSelectedFilter = () => {
		setSelectedFilter(prev => prev ? null : getSelectedFilter(Object.values(selectedRows)));
	};

	const selectedCount = Object.keys(selectedRows).length || '';

	return (
		<>
			<div className="multi-select-pager pull-right" style={{
				display: 'flex',
				justifyContent: 'end',
				alignItems: 'center'
			}}>
				{!paginationDisabled && <div style={{
					display: 'flex',
					justifyContent: 'end',
					alignItems: 'center'
				}}>
					<MemoizedPagingSummary
						currentPage={currentPage}
						count={count}
						total={total}/>
					<MemoizedPagination
						currentPage={currentPage}
						totalPages={totalPages}
						onPageChange={page => setCurrentPage(page)}/>
					<MemoizedItemsPerPage
						itemsPerPageOptions={itemsPerPageOptions}
						itemsPerPage={count}
						handleItemsPerPageChange={newPageSize => onItemsPerPageChange(newPageSize)}
					/>

				</div>}
				<a onClick={() => setShowVisibleColsModal(true)} className="fa fa-cog column-select-btn"></a>
				<Modal isOpen={showVisibleColsModal}
				       title="Visible Columns"
				       onClose={() => setShowVisibleColsModal(false)}
				       className="modal-sm">
					<div className="modal-body">
						<VisibleColumnsTable
							allColumns={columns.map(co => co.name)}
							visibleColumns={visibleOrderedColumns}
							onSelectionChange={selectedColumns => onVisibleColumnsChange(selectedColumns)}
						/>
					</div>
				</Modal>
			</div>
			{/* Hack to render the select all checkbox in place */}
			{multiselectOptions?.enabled && allCheckboxRef.current && ReactDOM.createPortal(
				<Checkbox
					id={`${tableId}-select-all-rows`}
					checked={isSelectedAll}
					indeterminate={isIndeterminate}
					disabled={multiselectOptions?.multiselectDisabled?.()}
					onChange={(e) => onAllRowsSelected(e.target.checked)}
				/>,
				allCheckboxRef.current
			)}
			<table className="table table-striped table-hover table-filtSort" ref={tableRef}>
				<thead>
					<tr>
						{multiselectOptions?.enabled && (
							<th className="fixed-size-column select-column">
								{multiselectOptions?.isViewSelectedEnabled
									? (<a href="#"
										onClick={onToggleSelectedFilter}
										title={selectedFilter ? 'View All' : 'View Selected Only'}
										style={{ textDecoration: 'underline' }}>
										{selectedCount}
									</a>)
									: selectedCount}
							</th>
						)}
						{columnsToShow.map((col) => (
							<MemoizedTableHeadCell
								key={col.name}
								col={col}/>
						))}
					</tr>

				</thead>
				<tbody>
					{rows.map((row, rowIndex) => (
						<tr key={rowIndex}>
							{multiselectOptions?.enabled && <td className="fixed-size-column">
								<Checkbox
									id={`${tableId}-check-row-${rowIndex}`}
									checked={!!selectedRows[getProperty(row, rowIdentifier)]}
									disabled={multiselectOptions?.multiselectDisabled?.() || multiselectOptions?.rowSelectionDisabled?.(row)}
									onChange={e => onRowSelected(row, rowIndex, e.target.checked)}
								/>
							</td>}
							{columnsToShow.map((col) => (
								<MemoizedTableRowCell
									key={col.name}
									col={col}
									row={row}/>
							))}
						</tr>
					))}
				</tbody>
			</table>
		</>
	);
});

export default FiltSortTable;
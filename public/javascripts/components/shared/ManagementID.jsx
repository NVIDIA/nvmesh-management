/*
 * SPDX-FileCopyrightText: Copyright (c) 2026 NVIDIA CORPORATION & AFFILIATES. All rights reserved.
 * SPDX-License-Identifier: Apache-2.0
 */

/* global React */
import { AppContext } from '../App.jsx';

const { useContext } = React;

const ManagementID = ({ id, displayMe = true }) => {
	const { systemInfo: { managementId } } = useContext(AppContext);

	return (
		<span>{id} {displayMe && id === managementId && <strong>(Me)</strong>}</span>
	);
};

export default ManagementID;
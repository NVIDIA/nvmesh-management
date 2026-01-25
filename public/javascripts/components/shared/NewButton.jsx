/*
 * SPDX-FileCopyrightText: Copyright (c) 2026 NVIDIA CORPORATION & AFFILIATES. All rights reserved.
 * SPDX-License-Identifier: Apache-2.0
 */

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
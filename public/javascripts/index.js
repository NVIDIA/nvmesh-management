/*
 * SPDX-FileCopyrightText: Copyright (c) 2026 NVIDIA CORPORATION & AFFILIATES. All rights reserved.
 * SPDX-License-Identifier: Apache-2.0
 */

/* global ReactDOM, React, $ */

import App from './components_js/App.js';

$(function() {
	const $body = $('body');

	$body.on('click', 'a[disabled="disabled"]', () => false);

	// Disables shift and control text selection, so it will not override shift checking
	// in multi select tables
	$body.mousedown(function(e) {
		if (e.ctrlKey || e.shiftKey) {
			// For non-IE browsers
			e.preventDefault();
		}
	});

	//pjax configuration
	$(document).pjax('a[data-pjax!="false"]', '#component', { timeout: 5000 });

	//A hack to take 'back' control from pjax
	$(window).off('popstate.pjax');
	$(window).on('popstate.pjax', function(event) {
		if (!event.state)
			return;

		var options = {
			url: event.state.url,
			container: event.state.container,
			timeout: event.state.timeout,
			id: event.state.id,
			fragment: event.state.fragment,
			scrollTo: false,
			push: false,

		};

		$.pjax(options);
	});

	$(document).on('pjax:start', () => {
		$('.content').animate({ left: '2000px' }, () => { });
	});

	$(document).on('pjax:end', () => {
		$('.content').finish().animate({ left: 0 }, 200);
	});

});

const reactAppElement = document.getElementById('root');
const root = ReactDOM.createRoot(reactAppElement);
root.render(React.createElement(App));

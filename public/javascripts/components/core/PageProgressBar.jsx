/* global React, $ */

const { useEffect, useRef, useState } = React;

const PageProgressBar = () => {
	const progressInterval = useRef(null);
	const [currentProgress, setCurrentProgress] = useState(0);
	const [showProgressBar, setShowProgressBar] = useState(false);

	const startProgressBar = () => {
		// Reset progress
		setCurrentProgress(0);
		setShowProgressBar(true);

		// Clear any existing interval
		if (progressInterval.current) {
			clearInterval(progressInterval.current);
		}

		// Start incrementing progress
		progressInterval.current = setInterval(() => {
			// Asymptotic increase - slows down as it approaches 95%
			// Progress increases quickly at first, then slows down
			let increment = (95 - currentProgress) * 0.1;

			// Ensure minimum increment for smooth animation
			if (increment < 0.5) {
				increment = 0.5;
			}

			setCurrentProgress(currentProgress + increment);

			// Cap at 95% until page actually loads
			if (currentProgress > 95) {
				setCurrentProgress(95);
			}

		}, 200);
	};
	
	const completeProgressBar = () => {
		// Clear the interval
		if (progressInterval.current) {
			clearInterval(progressInterval.current);
			progressInterval.current = null;
		}

		setCurrentProgress(100);
		setTimeout(() => {
			setShowProgressBar(false);
			setTimeout(() => setCurrentProgress(0), 400);
		}, 400);
	};

	useEffect(() => {
		$(document).on('pjax:send', startProgressBar);
		$(document).on('pjax:complete', completeProgressBar);
		return () => {
			$(document).off('pjax:send', startProgressBar);
			$(document).off('pjax:complete', completeProgressBar);
		};
	}, []);

	return (
		<div id="progress" style={{ width: `${currentProgress}%`, opacity: showProgressBar ? 1 : 0 }}></div>
	);
};

export default PageProgressBar;
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
			setCurrentProgress(prevProgress => {
				// Asymptotic increase - slows down as it approaches 95%
				let increment = (95 - prevProgress) * 0.1;

				// Ensure minimum increment for smooth animation
				if (increment < 0.5) {
					increment = 0.5;
				}

				const newProgress = prevProgress + increment;

				// Cap at 95% until page actually loads
				return newProgress > 95 ? 95 : newProgress;
			});

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
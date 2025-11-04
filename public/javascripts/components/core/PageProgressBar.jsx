/* global React */

const { useEffect, useRef, useState } = React;

const PageProgressBar = ({
}) => {
	const progressInterval = useRef(null);
	const [currentProgress, setCurrentProgress] = useState(0);
	const [showProgressBar, setShowProgressBar] = useState(false);

	function startProgressBar() {
		// Reset progress
		setCurrentProgress(0);
		setShowProgressBar(true);
		
		// Clear any existing interval
		if (progressInterval.current) {
			clearInterval(progressInterval.current);
		}
		
		// Start incrementing progress
		progressInterval.current = setInterval(function() {
			// Asymptotic increase - slows down as it approaches 95%
			// Progress increases quickly at first, then slows down
			var increment = (95 - currentProgress) * 0.1;
			
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
	}
	
	function completeProgressBar() {
		// Clear the interval
		if (progressInterval.current) {
			clearInterval(progressInterval.current);
			progressInterval.current = null;
		}
		
		setCurrentProgress(100);
		setTimeout(() => {
			setShowProgressBar(false);
			setCurrentProgress(0);
		}, 400);
	}

	useEffect(() => {
		$(document).on('pjax:send', startProgressBar);
		$(document).on('pjax:complete', completeProgressBar);
		return () => {
			$(document).off('pjax:send', startProgressBar);
			$(document).off('pjax:complete', completeProgressBar);
		};
	}, []);

	return (
		<div id="progress" style={{ width: `${currentProgress}%`, opacity: showProgressBar ? 1 : 0 }}><dt/><dd/></div>
	);
};

export default PageProgressBar;
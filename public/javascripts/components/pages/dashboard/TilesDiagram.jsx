/* global React */

const percentToColor = (percent) => {
	const colors = ['#97D073', '#00a65a', '#F9C117', '#e38d13', '#E31D38', '#E31D38'];
	return colors[Math.floor(percent / 20)];
};


const TilesDiagram = ({ targets }) => {
	const sortedTargets = targets.sort((a, b) => b.percent - a.percent);

	const handleTargetClick = (targetId) => {
		window.location.href = `/servers/server/${targetId}`;

	};

	return (
		<div className="tiles-diagram-container">
			{sortedTargets.map((target, index) => (
				<div
					key={index}
					style={{ backgroundColor: percentToColor(target.percent) }}
					className="tile-item"
					onClick={() => handleTargetClick(target._id)}
				>
					<div className="popover tile-tooltip segment-popover">
						<div className="segment-popover-body">
							<h3>{target._id}</h3>
							<div style={{ padding: '5px' }}>
								{Math.floor(target.percent)}% of drive space allocated
							</div>
						</div>
					</div>
				</div>
			))}
		</div>
	);
};

export default TilesDiagram; 
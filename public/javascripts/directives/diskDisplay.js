/*
 * SPDX-FileCopyrightText: Copyright (c) 2026 NVIDIA CORPORATION & AFFILIATES. All rights reserved.
 * SPDX-License-Identifier: Apache-2.0
 */

/* global angular,$,STATUS_COLORS,consts,c3,d3,SOCKET,EVENTS,getDiskID,WATCHERS */

var managementApp = angular.module('managementApp');

managementApp.filter('diskToHealthSmallCircleClass', function() {
	return function(disk) {
		if (disk) {
			return disk.status === 'Ok' && !disk.isOutOfService ? 'btn-success' : disk.status != 'Ok' && disk.isOutOfService ? 'btn-warning' : 'btn-danger';
		}
	};
});

managementApp.filter('diskToDiskDisplayIcon', function() {
	return function(disk) {
		if (disk) {
			var statusIconClass;

			if (disk.isExcluded)
				return 'fa fa-exclamation-circle';

			if (disk.isOutOfService) {
				if (disk.automaticallyEvicted)
					return 'fa fa-exclamation-circle red';
				else
					return 'fa fa-exclamation-circle yellow';
			}

			if (disk.isPendingFormat)
				return 'fa fa-exclamation-circle yellow';

			switch (disk.status) {
				case consts.diskStatus.OK:
					statusIconClass = '';
					break;
				case consts.diskStatus.NOT_INITIALIZED:
					statusIconClass = 'fa fa-exclamation-circle';
					break;
				case consts.diskStatus.INGESTING:
					statusIconClass = 'fa fa-exclamation-circle red';
					break;
				case consts.diskStatus.FORMATTING:
				case consts.diskStatus.FROZEN:
				case consts.diskStatus.INITIALIZING:
					statusIconClass = 'fa fa-cog fa-spin';
					break;
				default:
					statusIconClass = 'fa fa-exclamation-circle red';
					break;
			}

			return statusIconClass;
		}
	};
});

managementApp.filter('diskToHealth', function() {
	return function(disk) {
		if (disk) {
			var statusIconClass;

			if (disk.isPendingFormat)
				return 'fa fa-exclamation-circle yellow';

			if ((disk.isOutOfService && disk.automaticallyEvicted) || (disk.isExcluded && disk.excludedByManagement))
				return 'fa fa-exclamation-circle red';

			switch (disk.status) {
				case consts.diskStatus.OK:
				case consts.diskStatus.NOT_INITIALIZED:
					statusIconClass = '';
					break;
				case consts.diskStatus.INGESTING:
					statusIconClass = 'fa fa-exclamation-circle red';
					break;
				case consts.diskStatus.FORMATTING:
				case consts.diskStatus.FROZEN:
				case consts.diskStatus.INITIALIZING:
					statusIconClass = 'fa fa-cog fa-spin';
					break;
				default:
					statusIconClass = 'fa fa-exclamation-circle red';
					break;
			}

			return statusIconClass;
		}
	};
});

managementApp.filter('diskToStatusMessage', function() {
	return function(disk) {
		var statusMsg = '';
		switch (disk.status) {
			case consts.diskStatus.OK:
				statusMsg = 'Ok';
				break;
			case consts.diskStatus.NOT_INITIALIZED:
				statusMsg = 'Not formatted for NVMesh';
				break;
			case consts.diskStatus.INGESTING:
				statusMsg = 'Ingesting';
				break;
			case consts.diskStatus.FORMATTING:
			case consts.diskStatus.FROZEN:
				statusMsg = 'Formatting';
				break;
			case consts.diskStatus.INITIALIZING:
				statusMsg = 'Initializing';
				break;
			case consts.diskStatus.FORMAT_ERROR:
				statusMsg = 'Format Error';
				break;
			default:
				statusMsg = disk.status;
				break;
		}

		return statusMsg;
	};
});

managementApp.filter('diskToHealthMessage', function(diskToStatusMessageFilter) {
	return function(disk) {
		if (disk) {
			if (disk.isExcluded) {
				if (disk.excludeReason == consts.driveExcludeReasons.SWITCHED_ZONE)
					return 'Drive automatically excluded, zone mismatch between the drive and its current target';

				if (disk.excludeReason == consts.driveExcludeReasons.EXPLICIT)
					return 'Drive excluded by user';

				if (disk.excludeReason == consts.driveExcludeReasons.IN_USE)
					return 'Drive automatically excluded, as already managed by other software';

				return 'Drive excluded';
			}

			if (disk.isPendingFormat)
				return 'Pending Format';

			if (disk.isOutOfService)
				return disk.automaticallyEvicted ? 'Drive auto evicted.\n' + disk.autoEvictReason + '.' : 'Drive evicted by user';

			return diskToStatusMessageFilter(disk);
		}
	};
});

managementApp.filter('allocationToSeverity', function() {
	return function(usage) {
		return usage < 65 ? 'green' : 'yellow';
	};
});

managementApp.filter('trim', function() {
	return function(text) {
		return text ? text.replace(/_+$/, '') : '';
	};
});

managementApp.directive('diskdisplay', function($rootScope, $http, $confirm, $diskService, $compile) {
	return {
		restrict: 'E',
		replace: false,
		templateUrl: '/javascripts/directives/diskDisplay.html',
		scope: {
			disk: '=',
			volumeName: '@',
			diagramSize: '=',
			server: '<',
			useFullSizeModal: '='
		},
		controller: function($scope, $context) {
			var ctrl = this;
			$scope.user = $context.user;
			$scope.segments = {};
			$scope.iconClass;
			$scope.Math = Math;

			var SEGMENTS_COLORS = {
				PLACEHOLDER: STATUS_COLORS.PLACEHOLDER,
				NORMAL: STATUS_COLORS.NORMAL,
				DEAD: STATUS_COLORS.ERROR,
				UNDER_RECOVERY: STATUS_COLORS.ACTION,
				IS_RESERVED: STATUS_COLORS.ACTION
			};

			ctrl.processDiskSegments = function(segments, totalSize) {
				var segmentsForDisplay = [];
				var sum = 0;
				var isMerging = false;
				var subSegments = {};

				$scope.segmentsMap = {};

				for (let segmentIndex = 0; segmentIndex < segments.length; segmentIndex++) {
					const ds = segments[segmentIndex];

					var segmentSize = (ds.lbe - ds.lbs + 1);
					var percentageOfCurrSegment = (segmentSize / (totalSize - 32) * 100);
					subSegments[ds.id] = ds;

					if (percentageOfCurrSegment < consts.diskDisplay.MINIMAL_SEGMENT_PERCENTAGE &&
					!isMerging) {
						isMerging = true;
					}

					if (isMerging) {
						sum += segmentSize;
					}

					var percentageOfSum = (sum / (totalSize - 32) * 100);

					if (percentageOfSum > consts.diskDisplay.SEGMENTS_MERGING_THRESHOLD_PERCENTAGE) {

						if (ds.isPlaceHolder) {
							percentageOfSum = Math.max(percentageOfSum - percentageOfCurrSegment,
								consts.diskDisplay.MINIMAL_SEGMENT_PERCENTAGE);

							segmentIndex--;
							delete subSegments[ds.id];
						}

						var biggestSegment = null;

						var calcSegmentSize = function(segment) { return segment.lbe - segment.lbs + 1; };
						for (var id in subSegments) {
							if (!biggestSegment || calcSegmentSize(subSegments[id]) > calcSegmentSize(subSegments[biggestSegment]))
								biggestSegment = id;
						}

						$scope.segmentsMap[biggestSegment] = subSegments;

						segmentsForDisplay.push([biggestSegment, percentageOfSum]);
						sum = 0;
						isMerging = false;
						subSegments = {};
					} else if (percentageOfCurrSegment > consts.diskDisplay.MINIMAL_SEGMENT_PERCENTAGE &&
						!isMerging){
						segmentsForDisplay.push([ds.id, percentageOfCurrSegment]);
						$scope.segmentsMap[ds.id] = {};
						$scope.segmentsMap[ds.id][ds.id] = ds;
						subSegments = {};
					}
				}

				var data = segmentsForDisplay;
				var colors = {};

				segments.forEach(function(seg) {
					colors[seg.id] = getSegmentColor(seg);
				});

				return { data: data, colors: colors };
			};


			$scope.resetFilter = function() {
				$scope.segmentFilter['disks.diskSegments.lbs'] = undefined;
				$scope.segmentFilter['disks.diskSegments.lbe'] = undefined;
				$scope.reloadSegments();
			};


			$scope.hasVolumeSegments = function(disk) {
				return disk.diskSegments && disk.diskSegments.filter(function(seg) { return seg.type != consts.segmentTypes.EXCELERO_METADATA; }).length;
			};


			$scope.isDriveDeletable = function(server, drive) {
				return $diskService.isDriveDeletable(server, drive);
			};

			$scope.removeDisk = function(diskID, diskUUID) {
				if (confirm('You\'re going to delete drive: ' + diskID + '. are you sure?')) {
					$http.post('/disks/delete', [{ _id: diskID, uuid: diskUUID }]).success(function(data) {
						var $content = $('.content');

						if (data && data.length) {
							var success = data[0].success;
							var status = success ? 'success' : 'danger';
							$content.fadingAlert(status, success ? 'Drive ' + diskID + ' removed.' : 'Couldn\'t remove Drive: ' + diskID);
						}
					});
				}
			};

			function sendEvictDiskRequestByIdAndUUID(diskID, diskUUID) {
				$http.post('/disks/evictDiskByDiskIDsAndUUIDs', [{ diskID: diskID, uuid: diskUUID }]).success(function(data) {
					var $content = $('.content');

					if (data && data.length) {
						var res = data[0];
						if (res.success) {
							$content.fadingAlert('success', 'Disk is evicted');

							var editedDisk = $scope.disk;

							if (editedDisk) {
								editedDisk.isOutOfService = true;

								var segments = editedDisk.diskSegments;
								if (segments && segments.length)
									segments.forEach(function(ds) {
										if (!ds.owner || (ds.owner === consts.segmentOwners.NVMESH && ds.type !== consts.segmentTypes.EXCELERO_METADATA))
											ds.status = 'remap';
									});

								$('.disk[data-diskid="' + diskID + '"] .progress-bar:not(".progress-bar-success")')
									.attr('class', 'progress-bar progress-bar-striped');
							}
						} else
							$content.fadingAlert('danger', res.error || 'Couldn\'t evict disk');
					} else
						$content.fadingAlert('danger', 'Couldn\'t evict disk');
				});
			}

			$scope.evictDiskByDiskIDAndUUID = function(diskID, diskUUID) {
				$diskService.validateEvictAction([$scope.disk], function(allowEvict, shouldShowConfirm, msg) {
					if (!allowEvict)
						return $('.content').fadingAlert('danger', msg);

					if (shouldShowConfirm)
						$confirm({
							text: msg
						}).then(function() {
							sendEvictDiskRequestByIdAndUUID(diskID, diskUUID);
						});
					else
						sendEvictDiskRequestByIdAndUUID(diskID, diskUUID);
				});
			};

			$scope.formatDiskByDiskID = function(diskID, diskUUID) {
				var confirmText = 'Warning: You are about to format the drive. Formatting will erase all the data on this drive.';

				if ($scope.disk && $scope.disk.status === consts.diskStatus.NOT_INITIALIZED &&
					$scope.disk.GPT && $scope.disk.GPT.isValid && $scope.disk.GPT.entries && $scope.disk.GPT.entries.length)
					confirmText = 'Warning: Drive already contains other partitions. This operation will delete the existing partitions and is irreversible.';

				$confirm({
					text: confirmText
				}).then(function() {
					var formatObj = { disks: [{ _id: diskID, uuid: diskUUID }] };
					$http.post('/disks/formatDiskByIDsAndUUIDs', formatObj).success(function(data) {
						var $content = $('.content');

						if (data && data[0]._id && data[0].success) {
							$content.fadingAlert('success', 'Disk formatting command sent');

							var formattedDisk = $scope.disk;

							if (formattedDisk) {
								formattedDisk.isPendingFormat = true;
								if (formattedDisk.isOutOfService) {
									delete formattedDisk.isOutOfService;
									delete formattedDisk.automaticallyEvicted;
									delete formattedDisk.autoEvictReason;
								}
							}
						} else
							$content.fadingAlert('danger', 'Couldn\'t format drive, ' + data[0]?.error?.message || data[0]?.error);
					});
				});
			};


			//The function gets a range and used segments and looks for available segments.
			ctrl.getAvailableSegments = function(minValue, maxValue, diskSegments) {
				var segments = [];
				var minVal = minValue;

				if (diskSegments && diskSegments.length) {
					var sortedDiskSegments = diskSegments;
					if (diskSegments.length > 1)
						sortedDiskSegments = diskSegments.sort(function(a, b) { return a.lbs - b.lbs; });

					sortedDiskSegments.forEach(function(ds, i) {
						var blocksFromLeft = ds.lbs - minVal;
						if (blocksFromLeft > 0) {
							segments.push({
								lbs: minVal,
								lbe: ds.lbs - 1
							});
						}

						minVal = ds.lbe + 1;

						//If last segment check for available blocks in the end of the disk.
						if (diskSegments.length - 1 == i) {
							var totalBlocks = maxValue;
							if (minVal < totalBlocks)
								segments.push({
									lbs: minVal,
									lbe: totalBlocks - 1
								});
						}
					});
				} else {
					segments.push({
						lbs: minValue,
						lbe: maxValue - 1
					});
				}

				return segments;
			};

			function getSegmentColor(segment) {
				if (segment.isPlaceHolder)
					return SEGMENTS_COLORS.PLACEHOLDER;
				else if (segment.isDead)
					return SEGMENTS_COLORS.DEAD;
				else if (segment.status === 'normal')
					return SEGMENTS_COLORS.NORMAL;
				else if (segment.isReserved)
					return SEGMENTS_COLORS.IS_RESERVED;
				else
					return SEGMENTS_COLORS.UNDER_RECOVERY;
			}
		},
		link: function($scope, $element, attr, ctrl) {
			var $graphElement = $element.find('.disk-display');
			var chart;

			WATCHERS.push($scope.$watch('disk', function(disk) {
				if (!disk) return;

				$scope.disk = disk;

				SOCKET.addHandler(getDiskID($scope.disk.diskID) + '@' + EVENTS.diskEvictedEvent.name, function(data) {
					$rootScope.$evalAsync(function() {
						$scope.disk.isOutOfService = true;
						if (data && data.payload && data.payload.automaticallyEvicted)
							$scope.disk.automaticallyEvicted = true;
					});
				});

				var segmentStatuses = {};
				var volumeUUIDs = [];
				if ($scope.disk.diskSegments)
					$scope.disk.diskSegments.forEach((s)=> {
						if (s.type != consts.segmentTypes.EXCELERO_METADATA) {
							segmentStatuses[s.uuid] = s;
							volumeUUIDs.push(s.volumeUUID);
						}
					});

				function getSegmentStatuses() {
					var segIDsForStatus = Object.keys(segmentStatuses);
					if (segIDsForStatus.length) {
						var params = { segmentUUIDs: JSON.stringify(Object.keys(segmentStatuses)), volumeUUIDs: JSON.stringify(volumeUUIDs) };
						return $http.get('/volumes/getSegmentsStatus', { params: params });
					} else
						return new Promise((resolve) => resolve());
				}

				getSegmentStatuses()
					.then(function(res) {
						// update disk segment statuses from volume
						if (res)
							Object.keys(res.data).forEach((segID)=>{
								segmentStatuses[segID].status = res.data[segID];
							});
					}).then(afterSegmentStatusUpdated)
					.catch(console.error);
			}));

			function afterSegmentStatusUpdated() {
				var segments = getSegments($scope.disk);

				segments.forEach(function(seg) {
					$scope.segments[seg.id] = seg;
				});

				var dataObj = ctrl.processDiskSegments(segments, $scope.disk.usableBlocks);

				if (chart)
					chart.load({
						columns: dataObj.data,
						colors: dataObj.colors
					});
				else
					initGraph(dataObj);
			}
			function getInnerRadiusFromArc(arc) {
				var numbersInPattern = _getArcNumbers(arc);

				if (numbersInPattern.length < 4) return 0;

				return Math.min.apply(null, numbersInPattern);
			}

			function getOuterRadiusFromArc(arc) {
				var numbersInPattern = _getArcNumbers(arc);

				return Math.max.apply(null, numbersInPattern);
			}

			function _getArcNumbers(arc) {
				var pathDescription = arc.getAttribute('d');

				const numberRegExp = /[-+]?[0-9]*\.?[0-9]+([eE][-+]?[0-9]+)?/g;
				var arcPattern = new RegExp('A' + numberRegExp.source + ',' + numberRegExp.source, 'g');
				var arcParameters = pathDescription.match(arcPattern);

				var numbersInPattern = [];

				for (var parameterIndex = 0; parameterIndex < arcParameters.length; parameterIndex++) {
					var parameter = arcParameters[parameterIndex];

					var numbers = parameter.match(numberRegExp);

					if (numbers !== null)
						numbersInPattern = numbersInPattern.concat(numbers);
				}

				numbersInPattern = numbersInPattern.map(function(numberString) {
					return parseFloat(numberString);
				});

				return numbersInPattern;
			}

			//Turn the disk's segments to progressBars: used, free(placeholder) and reserved
			function getSegments(disk) {
				var arcs = [];
				var placeHolders = [];
				var availableReserved = [];
				var segments = [];

				var firstUsableLba = 32;
				if (disk.GPT && (disk.GPT.firstUsableLba || disk.GPT.firstUsableLba === 0))
					firstUsableLba = disk.GPT.firstUsableLba;

				//Get all the free segments.
				placeHolders = ctrl.getAvailableSegments(firstUsableLba, disk.usableBlocks, (disk.diskSegments || [])
					.filter(function(e) { return !e.fromReserved; }));

				if (disk.diskSegments && disk.diskSegments.length) {
					//Reserved segments
					var reservedSegments = disk.diskSegments.filter(function(segment) { return segment.isReserved; });
					//Regular segments
					segments = disk.diskSegments.filter(function(segment) {
						return !segment.isReserved && segment.type !== consts.segmentTypes.EXCELERO_METADATA;
					});

					//Check for each reserved the available reserved space.
					reservedSegments.forEach(function(rs) {
						availableReserved = availableReserved.concat(ctrl.getAvailableSegments(rs.lbs, rs.lbe + 1, segments));
						availableReserved.forEach(function(e) { e.isReserved = true; e.volumeName = rs.volumeName; });
					});
				}

				placeHolders.forEach(function(e) { e.placeholder = true; });

				placeHolders.concat(segments, availableReserved).forEach(function(segment, index) {
					var blocks = disk.usableBlocks;
					var arc = {
						id: segment._id || 'spacer' + index,
						lbs: segment.lbs,
						lbe: segment.lbe,
						status: segment.isDead ? 'dead' : segment.status,
						isDead: segment.isDead,
						allocationIndex: segment.allocationIndex,
						volumeName: segment.volumeName,
						partitionName: segment.partitionName,
						startPercent: segment.lbs / blocks * 100,
						endPercent: segment.lbe / blocks * 100,
						isPlaceHolder: segment.placeholder,
						isReserved: segment.isReserved,
						fromReserved: segment.fromReserved,
						type: segment.type,
						owner: segment.owner
					};

					arcs.push(arc);
				});

				return arcs.sort(function(a, b) { return a.lbs - b.lbs; });
			}

			function getSegmentTooltipHTML(segment) {
				var str = '<disk-segment-tool-tip model="segmentsMap[\'' + segment.id + '\']"/>';

				var elem = $compile(angular.element(str)[0])($scope);
				$scope.$digest();

				return elem.html();
			}

			function highlightVolumeSegments() {
				if (!$scope.disk.diskSegments || !$scope.disk.diskSegments.length) return;

				var volumeSegments = $scope.disk.diskSegments.filter(function(ds) { return ds.volumeName && ds.volumeName === $scope.volumeName; });

				volumeSegments.forEach(function(segment) {
					var e = d3.select('.c3-arc-' + segment._id)[0][0];
					if (!e)
						return;

					var outerRadius = getOuterRadiusFromArc(e);
					var innerRadius = getInnerRadiusFromArc(e);

					var arc = d3.svg.arc(e);
					arc.innerRadius(innerRadius);
					arc.outerRadius(outerRadius + 5);

					d3.select(e).attr('d', arc);
				});
			}

			function initGraph(dataObj) {
				chart = c3.generate({
					size: {
						width: 350,
						height: 350
					},
					bindto: $graphElement[0],
					data: {
						type: 'donut',
						order: null,
						columns: dataObj.data,
						colors: dataObj.colors,
						onmouseover: function(d, e) {
							if (d.id.indexOf('spacer') > -1) {
								$graphElement.find('g.c3-chart-arc').attr('style', 'opacity:1 !important');

								d3
									.select(e)
									.transition()
									.attr('d', d3.select(e).attr('d'));
							}
						},
						onmouseout: function() {
							$graphElement.find(' g.c3-chart-arc').attr('style', '');

							setTimeout(highlightVolumeSegments, 100);
						},
						onclick: function(d) {

							var minLbs = -1;
							var maxlbe = 0;
							//create lbs-lbe filter
							for (const id in $scope.segmentsMap[d.id]) {
								const segment = $scope.segmentsMap[d.id][id];

								if (maxlbe < segment.lbe)
									maxlbe = segment.lbe;

								if (minLbs > segment.lbs || minLbs === -1)
									minLbs = segment.lbs;
							}

							$scope.segmentFilter['disks.diskSegments.type'] = { $ne: consts.segmentTypes.EXCELERO_METADATA };
							$scope.segmentFilter['disks.diskSegments.lbs'] = { $gte: minLbs };
							$scope.segmentFilter['disks.diskSegments.lbe'] = { $lte: maxlbe };

							$scope.reloadSegments();
							var modalID = '#segmentsModal_' + $scope.disk.uuid;
							$(modalID).modal('show');
						}
					},
					legend: {
						show: false
					},
					donut: {
						width: 30,
						label: {
							show: false
						}
					},
					tooltip: {
						format: {

						},
						contents: function(d) {
							var segment = $scope.segments[d[0].id];

							return segment.isPlaceHolder ? '' : getSegmentTooltipHTML(segment);
						},
						position: function(d, e, r, shape) {
							var position = c3.chart.internal.fn.tooltipPosition.apply(this, arguments);

							if (d3.mouse(shape)[0] > 0)
								position.left -= 130;

							return position;
						}
					},
					onrendered: function() {
						setTimeout(function() {
							if (!$scope.volumeName)
								return false;

							highlightVolumeSegments();
						}, 100);
					}
				});
			}
		}
	};
});

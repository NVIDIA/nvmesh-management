/* global angular,$ */

var managementApp = angular.module('managementApp');

managementApp.directive('selectable', ['$compile', 'keysPressedService', function($compile, keysPressedService) {
	return { require:
		{
			multiSelectCtrl: '^^multiSelect'
		},
	scope: {
		model: '<',
		id: '@',
		key: '=key',
		onSelectionChanged: '='
	},
	restrict: 'A',
	bindToController: true,
	controllerAs: 'selectableCtrl',
	link: function(scope, element, attrs, required) {
		var newElem = angular.element('<td class="fixed-size-column"><div class="md-checkbox">' +
			'<input id="check-{{::selectableCtrl.id}}" type="checkbox" ng-model="selectableCtrl.isSelected" ng-change="selectableCtrl.checkBoxClicked()" ' +
			'ng-disabled="selectableCtrl.multiSelectCtrl.isDirty || selectableCtrl.isDisabled" ng-blur="selectableCtrl.onFocusLost()" class="row-check-box">' +
			'<label for="check-{{::selectableCtrl.id}}"></label></div></td>');
		element.prepend(newElem);
		$compile(newElem)(scope);
		scope.$on('$destroy', function() {
			if (required.multiSelectCtrl.childRows)	{
				var idx = required.multiSelectCtrl.childRows.indexOf(scope.selectableCtrl);
				required.multiSelectCtrl.childRows.splice(idx, 1);
				required.multiSelectCtrl.determineState();

				if (required.multiSelectCtrl.lastFocused == scope.selectableCtrl)
					required.multiSelectCtrl.lastFocused = null;
			}
		});

		if (!required.multiSelectCtrl.childRows)
			required.multiSelectCtrl.childRows = [];

		scope.selectableCtrl.rowIdx = required.multiSelectCtrl.childRows.length;
		required.multiSelectCtrl.childRows.push(scope.selectableCtrl);


		scope.selectableCtrl.isSelected = required.multiSelectCtrl.selected[scope.selectableCtrl.key] != null;
		scope.selectableCtrl.selectOrUnselect();

		scope.selectableCtrl.isDisabled = !!required.multiSelectCtrl.selected[scope.selectableCtrl.key]?.disabled;

		required.multiSelectCtrl.determineState();
	},
	controller: ('selectableController', ['$scope', function($scope) {
		var controller = this;

		controller.onFocusLost = function() {
			controller.multiSelectCtrl.lastFocused = controller;
		};

		controller.checkBoxClicked = function() {

			if (keysPressedService.isShiftDown() &&
			controller.multiSelectCtrl.lastFocused) {
				var start = Math.min(controller.multiSelectCtrl.lastFocused.rowIdx,	controller.rowIdx);
				var end = Math.max(controller.multiSelectCtrl.lastFocused.rowIdx, controller.rowIdx);
				controller.multiSelectCtrl.selectOrUnselectRange(start, end, controller.isSelected);
			} else {
				controller.selectOrUnselect();
				controller.multiSelectCtrl.determineState();

				if (controller.onSelectionChanged)
					controller.onSelectionChanged(controller.key, controller.model, controller.isSelected);

				$scope.$applyAsync();
			}
		};

		controller.selectOrUnselect = function(){

			if (controller.isSelected) {
				if (!controller.multiSelectCtrl.selected[controller.key])
					controller.multiSelectCtrl.selected[controller.key] = controller.model;
			} else {
				controller.unselect();
			}
		};

		controller.unselect = function(){
			if (controller.multiSelectCtrl.selected[controller.key] != null){
				delete controller.multiSelectCtrl.selected[controller.key];
				controller.multiSelectCtrl.childUnselected();
			}
		};
	}
	]) };
}]);

managementApp.directive('multiSelect', ['$compile', '$timeout', '$templateRequest', function($compile, $timeout, $templateRequest) {
	function addExtraElements(element, scope, singleHeaderTable) {
		scope.keys = Object.keys;
		$templateRequest('/javascripts/directives/multiSelectTableElements/actions.html').then(function(html){
			var actions = angular.element(html);
			element[0].parentElement.insertBefore(actions[0], element[0]);
			$compile(actions)(scope);
		});
		$templateRequest('/javascripts/directives/multiSelectTableElements/allCheckBox.html').then(function(html){
			var allCheckBox = angular.element(html);
			if (singleHeaderTable)
				element[0].tHead.rows[0].prepend(allCheckBox[0]);
			else
				element[0].tHead.rows[1].prepend(allCheckBox[0]);

			$compile(allCheckBox)(scope);
		});
		$templateRequest('/javascripts/directives/multiSelectTableElements/header.html').then(function(html){
			var header = angular.element(html);
			if (!singleHeaderTable)
				element[0].tHead.rows[0].prepend(header[0]);
			$compile(header)(scope);
		});
	}


	return { restrict: 'A',
		scope: {
			selected: '=',
			onAllSelectionChanged: '=',
			isSelected: '=?isChecked',
			allPagesSelected: '=?',
			totalItems: '=',
			actions: '=',
			isDirty: '=?',
			pendingAction: '=?',
			id: '@?',
			create: '=?',
			minItemsPerPage: '@',
			singleHeaderTable: '=?'
		},
		bindToController: true,
		controllerAs: 'multiSelectCtrl',
		link: function(scope, element, attrs) {

			var create = function(){

				var proto = {};

				proto.getValues = function() {
					var values = [];
					for (const key in scope.multiSelectCtrl.selected) {
						if (Object.prototype.hasOwnProperty.call(scope.multiSelectCtrl.selected, key)) {
							values.push(scope.multiSelectCtrl.selected[key]);
						}
					}

					return values;
				};

				scope.$watch('multiSelectCtrl.selected', function(){
					if (Object.getPrototypeOf(scope.multiSelectCtrl.selected) != proto)
						Object.setPrototypeOf(scope.multiSelectCtrl.selected, proto);
				});

				Object.setPrototypeOf(scope.multiSelectCtrl.selected, proto);

				addExtraElements(element, scope, scope.multiSelectCtrl.singleHeaderTable);

				scope.$on('$destroy', function() {
					if (scope.multiSelectCtrl.onAllSelectionChanged)
						scope.multiSelectCtrl.onAllSelectionChanged(false);
				});


				if (scope.multiSelectCtrl.childRows)
					scope.multiSelectCtrl.isSelected = scope.multiSelectCtrl.childRows.every(function(row){ return row.isSelected; });
				else
					scope.multiSelectCtrl.isSelected = false;
			};

			if (attrs['create']){
				scope.multiSelectCtrl.create = create;
			} else
				$timeout(create);
		},
		controller: ('multiSelectController', [function() {
			var controller = this;
			controller.isSelected = false;
			controller.isDirty = false;

			controller.getNumOfSelected = function() {
				return Object.keys(controller.selected).length;
			};

			controller.verifyAction = function(action) {
				var actionConfirmed = function() {
					controller.pendingAction = action;
					controller.isDirty = true;
					setTimeout(function() { $('#saveChangesAnchor').focus(); }, 0);
				};

				if (action.preSave)
					action.preSave(actionConfirmed);
				else
					actionConfirmed();
			};

			controller.cancel = function() {
				controller.pendingAction.actionCanceled &&
					controller.pendingAction.actionCanceled();
				controller.pendingAction = null;
				controller.isDirty = false;
			};

			controller.save = function() {
				controller.pendingAction.click();
				controller.pendingAction = null;
				controller.isDirty = false;
			};

			controller.childUnselected = function()	{
				controller.isSelected = false;

				if (controller.onAllSelectionChanged)
					controller.onAllSelectionChanged(controller.isSelected);

			};

			controller.selectOrUnselectAll = function(){

				if (controller.isIndeterminate) {
					controller.isSelected = false;
				}

				controller.childRows.forEach(child => {
					if (child.isDisabled)
						return;
					if (child.isSelected != controller.isSelected)	{
						child.isSelected = controller.isSelected;
						child.selectOrUnselect(false);
					}
				});

				controller.isIndeterminate = false;

				if (controller.onAllSelectionChanged)
					controller.onAllSelectionChanged(controller.isSelected, true);
			};

			controller.selectOrUnselectRange = function(startIndex, endIndex, value){
				for (var index = startIndex; index <= endIndex; index++) {
					var child = controller.childRows[index];

					child.isSelected = value;
					child.selectOrUnselect();
				}

				controller.determineState();

				if (controller.onAllSelectionChanged)
					controller.onAllSelectionChanged(controller.isSelected);
			};

			controller.determineState = function() {
				controller.isSelected = controller.childRows.length > 0 &&
					controller.childRows.every(function(row){ return row.isSelected; });
				controller.isIndeterminate =
					!controller.isSelected && controller.childRows.some(function(row){ return row.isSelected; });
			};
		}
		]) };
}]);
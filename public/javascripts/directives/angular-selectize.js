/*
 * SPDX-FileCopyrightText: Copyright (c) 2026 NVIDIA CORPORATION & AFFILIATES. All rights reserved.
 * SPDX-License-Identifier: Apache-2.0
 */

var managementApp = angular.module('managementApp');

managementApp.directive("selectize", ['$timeout', function($timeout) {
	return {
	  restrict: 'E',
	  //require: '^form',
	  scope: {
		ngModel: '=',
		options: '=',
		ngDisabled: '=',
		ngRequired: '=',
		ngFocus: '&',
		ngBlur: '&',
		activeOption: '=?',
		config: '&',
		textField : '@?',
		valueField : '@?',
		singleItem: "=", //true to return single item, false to return list
		itemValidator: '=?'
	  },
	  link: function(scope, element, attrs) {

		selectElement = element;

		Selectize.defaults.maxItems = null; //default to tag editor

		var selectize,
			config = angular.extend({}, Selectize.defaults, scope.config());

		if (config.create) {
		  config.create = function(input) {
			var item = { value: input, text: input };
			if (validateItem(item)) {
				return item;
			} else {
			  return null;
			}
		  };
		}

		function createItem(input) {
		  var data = {};
		  data[config.labelField] = input[scope.textField] || input;
			data[config.valueField] = input[scope.valueField] || input;

			// override some wierd behavior where u could not add more then 1 object
			// this is caused by selectize comparing values by their string representation to prevent double option instead of by the label
			if( (typeof	data[config.valueField] === "object") && (data[config.valueField] !== null) ) {
				data[config.valueField] .toString = function() {
					return data[config.valueField]._id || data[config.labelField];
				};
				return data;
			}

		  return data;
		}

		function toggle(disabled) {
		  disabled ? selectize.disable() : selectize.enable();
		}

		function validate() {
		  if (!!attrs.name){
			var ngRequired = scope.ngRequired
		  }
		};

		// verify every item is a valid option
		function validateItemsAreValidOptions(items) {
		  if (items) {
			var isValid = true;
			items.forEach(validateItem);
		  }
		}

		function validateItem(item) {
			if (item in selectize.options) {
				return true;
			} else if (config.create) {
				if (scope.itemValidator)
					return scope.itemValidator(item.value);
				else
					return true
			} else {
				var msg = 'Item ' + item.value + ' is not a valid option - item is removed';
				console.warn(msg);
				element.change();
				return false;
			}
		}

		function generateOptions(data) {
		  if (!data)
			return [];

		  data = angular.isArray(data) || angular.isObject(data) ? data : [data]

		  return $.map(data, function(opt) {
			return createItem(opt);
			console.log(config);
		  });
		}

		function updateSelectizeItems() {
		  validate();

		  if (!angular.equals(selectize.items, scope.ngModel)) {
			updateValues();
		  }
		}

		function updateOptions() {
		  if (typeof scope.options === "number") {
			  optionsObject = createObjectFromNumber(scope.options);
		  } else {
			  optionsObject = scope.options;
		  }

		  if (!angular.equals(selectize.options, optionsObject)) {
			  if (optionsObject) {
				selectize.clearOptions();
				if (typeof optionsObject[0] == "string") {
					var generatedOptions = generateOptions(optionsObject);
					selectize.addOption(generatedOptions);
				} else {
					selectize.addOption(optionsObject);
				}
			  }
		  }

		  // after removing all options and then adding items again,
		  // items in ngModel that are not in the Available options will not be added
		  // WARNING: if an option was removed while an item of the same value exists,
		  // an inconsistency between the ngModel and the directive selectize.items (value) will occure.
		  // the item will not be added to the list since no corresponding option exist, but the ngModel will not change
		  updateSelectizeItems();
		}

		function createObjectFromNumber (maxNumber) {
			var optionsObject = {};
			for (var i = 1; i <= maxNumber; ++i)
				optionsObject[i.toString()] = i.toString();
			return optionsObject;
		}

		function arrayToObject(arr) {
			var newObject = {};
			arr.forEach(function (item) {
				if (!item)
				  return;
				itemStr = item.toString();
				newObject[itemStr] = itemStr;
			});

			return newObject;
		}

		function setValueInModel(){
		  var value
		  if (selectize.items.length > 0) {
			  value = selectize.items.map(function(key) {return selectize.options[key].value});
		  } else {
			  value = [];
		  }
		  // return single item and not list when maxItems set to 1
		  scope.ngModel = scope.singleItem && !!scope.config() && scope.config().maxItems == 1 ? value[0]: value
		}

		var angularCallback = config.onInitialize;

		function updateValues() {
			if (selectize.items && selectize.items.length)
				selectize.clearOptions();

			if (Array.isArray(scope.ngModel)) {
				ngModel = scope.ngModel
			  } else {
				ngModel = !!scope.ngModel? [scope.ngModel] : []
			  }

			  valueObject = arrayToObject(ngModel);
			  if (scope.options) {
				selectize.setValue(valueObject);
			  } else if (ngModel) {
				ngModel.forEach(function(item) {
				  selectize.addOption({
					  text: item,
					  value: item
				  });

				  selectize.addItem(item);
				});
			  }
		}

		config.onInitialize = function() {
			selectize = selectElement[0].selectize;
			var ngModel;
			updateOptions();
			updateValues();

			// provides a way to access the selectize element from an
			// angular controller
			if (angularCallback) {
			  angularCallback(selectize);
			}

			selectize.innerOnOptionHover = selectize.onOptionHover;
			selectize.onOptionHover = function(event)
			{
			  scope.activeOption = event.currentTarget.dataset.value;
			  scope.$applyAsync();
			  selectize.innerOnOptionHover(...arguments);
			}

			selectize.innerClose = selectize.close;
			selectize.close = function(event)
			{
			  scope.activeOption = null;
			  scope.$applyAsync();
			  selectize.innerClose(...arguments);
			}

			selectize.innerAddItem = selectize.addItem;
			selectize.addItem = function(event)
			{
			  scope.activeOption = null;
			  selectize.innerAddItem(...arguments);
			}

			if (scope.ngFocus)
				selectize.on("focus", scope.ngFocus);

			if (scope.ngBlur)
				selectize.on("blur", scope.ngBlur);

			scope.$watchCollection('options', updateOptions);
			scope.$watchCollection('ngModel', updateSelectizeItems);
			scope.$watch('ngDisabled', toggle);
		};

		selectElement.selectize(config);

		selectElement.on('change', function() {
		  $timeout(function() {
			  setValueInModel();
			  validate();
		  });
		});

		selectElement.on('$destroy', function() {
		  if (selectize) {
			selectize.destroy();
			selectElement = null;
		  }
		});
	  }
	};
  }]);

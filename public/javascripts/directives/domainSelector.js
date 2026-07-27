/* global angular,$, WATCHERS */
var managementApp = angular.module('managementApp');

managementApp.component('domainSelector', {
	bindings: {
		domains: '=',
		selectedDomains: '=',
		clear: '=',
		addItems: '=',
		invalidNameExists: '='
	},
	controller: ['$timeout', '$scope', function($timeout, $scope) {
		var controller = this;
		var domainsSelectize;
		controller.invalidNames = [];

		controller.clear = function(){
			domainsSelectize.clear();
		};

		controller.addItems = function(items) {
			domainsSelectize.addOption(items.map(function(item) { return { text: item, value: item }; }));
			domainsSelectize.addItems(items);
		};

		controller.invalidName = function(name) {
			controller.isNameInvalid = name && name.match(/^[\w \-_]{1,32}:[\w \-_]{1,32}$/) === null;
			return controller.isNameInvalid;
		};

		controller.invalidNameExists = function() {
			return controller.invalidNames.length !== 0;
		};

		$timeout(function(){
			initDomainsSelectize(controller.domains);
		});

		WATCHERS.push($scope.$watchCollection('domainSelectorCtrl.domains', function(newDomains) {
			if (domainsSelectize)
				domainsSelectize.addOption(newDomains.map(function(d) { return { text: d, value: d }; }));
		}));

		function initDomainsSelectize(data) {
			domainsSelectize = $('#domainsSelect').selectize({
				create: function(input) {
					return { value: input, text: input };
				},
				onItemAdd: function(value) {
					$scope.$applyAsync(function(){
						if (controller.invalidName(value)) {
							var domainNameDiv = $('div[data-value=' + CSS.escape(value) + ']');
							domainNameDiv.addClass('has-error');
							domainNameDiv.attr('title', 'The domain name should be in the following format: <scope:identifier>,'
							+ ' where scope and identifier names should be no longer than 32 characters and can contain any word character, space, - and _.');

							controller.invalidNames.push(value);
						} else {
							var domain = value.split(':');
							var selectedDomain = { scope: domain[0], identifier: domain[1] };
							controller.selectedDomains.push(selectedDomain);
						}
					});
				},
				onItemRemove: function(value) {
					$scope.$applyAsync(function(){
						controller.selectedDomains.pop();
						domainsSelectize.removeOption(value);

						var indexOfValue = controller.invalidNames.indexOf(value);
						if (indexOfValue !== -1) {
							controller.invalidNames.splice(indexOfValue, 1);
						}
					});
				}
			})[0].selectize;

			//Add available options
			domainsSelectize.addOption(data.map(function(d) { return { text: d, value: d }; }));
		}
	}],
	controllerAs: 'domainSelectorCtrl',
	templateUrl: 'javascripts/directives/domainSelector.html'
});

/* global angular,CookieManager*/
var managementApp = angular.module('managementApp');

managementApp.component('selectColumns', {
	restrict: 'E',
	replace: true,
	bindings: {
		entityName: '@'
	},
	bindToController: true,
	controller: ['$compile', '$scope', '$rootScope', function($compile, scope, $rootScope) {

		const controller = this;
		controller.selected = {};

		function updateSelected() {
			const conf = CookieManager.getJSON('nvmesh-column-config');
			const entityConfig = conf[controller.entityName];
			controller.columnNames = entityConfig ? Object.keys(entityConfig) : [];

			for (let name in entityConfig) {
				if (entityConfig[name])
					controller.selected[name] = name;
			}
		}

		updateSelected();

		controller.saveSelection = function(){
			const conf = CookieManager.getJSON('nvmesh-column-config');
			for (var columnName in conf[controller.entityName]) {
				conf[controller.entityName][columnName] = false;
			}

			controller.selected.getValues().forEach(function(columnName) {
				conf[controller.entityName][columnName] = true;
			});

			CookieManager.setJSON('nvmesh-column-config', conf);
			$rootScope.$broadcast('columnsChanged-' + controller.entityName);
		};


		scope.$watch(() => {
			const conf = CookieManager.getJSON('nvmesh-column-config');
			return conf && !conf[controller.entityName];
		}, () => {
			updateSelected();
		});

	}],
	controllerAs: 'selectColumnsCtrl',
	templateUrl: 'javascripts/directives/selectTableColumns.html'
});
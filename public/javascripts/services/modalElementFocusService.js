/* global angular,$ */

var managementApp = angular.module('managementApp');

managementApp.service('modalElementFocusService', function(){
	this.focus = function(modalName, elementID) {
		$('#' + modalName).on('shown.bs.modal', function() { $('#' + elementID).focus(); });
	};
});
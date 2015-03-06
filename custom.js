var Scope = require('./scope.js');

// Callexpressions
var custom = module.exports.custom = [
function(scope, node, ce) { // http.get
	var ceName = scope.resolve(ce.name);
	if (ceName != 'require(\'http\').get') {
		return false;
	}
	
	var func = ce.arguments[1];

	func.scope.sources.push(func.params[1]);
	func.scope.log('SOURCE', node, false, func.params[1]);
	traverse(func.body, func.scope);
	return true;
}, function(scope, node, ce) {// (new require('hapi').server()).route()
	if (ce.name.indexOf('require(\'hapi\').Server()') === 0)
		return false;
	var ceName = scope.resolve(ce.name);
	if (typeof ceName != "string" || ceName.split('.').slice(-1)[0] != 'route')
		return false;

	if (ce.arguments[0]) {
		var func;
		if (ce.arguments[0].config && ce.arguments[0].config.handler) {
			func = ce.arguments[0].config.handler;
		} else {
			func = ce.arguments[0].handler;
		}

		if (func && func.scope) {
			func.scope.sources.push(func.params[0]);
			func.scope.log('SOURCE', node, false, func.params[0]);
			traverse(func.body, func.scope);
		}
	}

	return true;

}, function(scope, node, ce) {// (new require('express').Router()).route() && .post()
	var ceName = scope.resolve(ce.name);
	if (typeof ceName != "string" || ceName.indexOf('express') == -1)
		return false;
	if (['post', 'get'].indexOf(ceName.split('.').slice(-1)[0]) == -1)
		return false;

	if (ce.arguments && ce.arguments[1]) {
		var func = ce.arguments[1];

		if (func && func.scope) {
			func.scope.sources.push(func.params[0]);
			func.scope.log('SOURCE', node, false, func.params[0]);
			traverse(func.body, func.scope);

		}
	}

	return true;

}, function(scope, node, ce) {// require('fs').readFile
	var ceName = scope.resolve(ce.name);
	if (ceName != 'require(\'fs\').readFile') {
		return false;
	}
	
	var func = ce.arguments[2]; // the callback
	if (func && func.scope) {
		func.scope.sources.push(func.params[1]); // the 2nd argument is the source
		func.scope.log('SOURCE', node, false, func.params[1]);

		traverse(func.body, func.scope);
	}
	return true;
}];

module.exports = custom;
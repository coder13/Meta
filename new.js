var m = require('module');
var hapi = require('hapi');
var esprima = require('esprima');


function printChildren(parent, scope) {
	scope = scope||'-';
	parent.forEach(function (i) {
		console.log(scope, i.id);
		printChildren(i.children, scope+'-');
	});
}

printChildren(module.children);

// console.log(m._resolveLookupPaths('boom', hapi));

/*
	eval(String(require('fs').readFileSync(process.argv[1]));
*/

var file = process.argv[2],
	colors = require('colors'),
	fs = require('fs'),
	path = require('path'),
	esprima = require('esprima'),
	estraverse = require('estraverse'),
	_ = require('underscore');

var input = fs.readFileSync(file);
var astInput = esprima.parse(input, {loc: true});

fs.writeFileSync("checkASTOutput.json",JSON.stringify(esprima.parse(input)));

var sinks = require('./danger.json').sinks,
	sources = require('./danger.json').sources, modules = [];

createNewScope(astInput, {}, []);

function createNewScope(ast, parentVars, params) {
	console.log('creating new scope'.red);
	var vars = parentVars;


	estraverse.traverse(ast, {
		enter: function (node, parent) {
			// console.log(node);
			// if (parent && (parent.type != 'Program' && parent.type != 'BlockStatement')) { 
			// 	// Check top level expressions only
			// 	// Don't remember why I was doing this
			// 	this.skip();
			// } 
			
			switch (node.type) {
				case 'VariableDeclarator':
					if (node.init) {
						track(node);
					}
					break;
				case 'CallExpression':
					ce = resolveCallExpression(node);
					if (ce.name) {
						var ceName = f(ce.name);

						console.log('[CE]'.green, pos(node), ce.name, ceName);
						if (isSink(ceName)) {
							console.log('[SINK]'.red, pos(node), ceName);
						}
					
						if (vars[ce.name]) {
							var func = vars[ce.name];
							var args = _.object(func.params, ce.arguments);
							createNewScope(func.body, _.extend(vars, args));

						}

					}
						
					break;
				case 'ExpressionStatement':
					try {
						resolveExpression(node.expression, parent);
					
					} catch(e) {
						console.error(e);
						console.log(node);
					}
					break;
				case 'FunctionDeclaration':
					// console.log(node);
					var func = resolveFunctionExpression(node);
					vars[func.name] = func;

					console.log('[FUNC]'.blue, pos(node), func.name, func);
					break;
			}

		}
	});

	// handles creation of variables. 
	function track(variable) {
		// console.log(variable);
		var name = variable.id.name;

		var value = resolveRight(variable.init);

		vars[name] = value;

		console.log('[VAR]'.blue, pos(variable), name, value);
		
	}

	function f(name) { // rename later; returns a value for a variable if one exists
		var s = name.indexOf('.') == -1 ? name : name.split('.').slice(0,-1).join('.');
		return vars[s] ? name.replace(s, vars[s].raw) : name;
	}

	// Resolves variables and returns a simplifed version. 
	function resolveRight(right) {
		switch (right.type) {
			case 'Literal':
				return right.raw;
			case 'Identifier':
				// if variable is being set to a bad variable, mark it too as bad
				if (isVarableASource(f(right.name))) {
					console.log('[SOURCE]'.red, right.name, f(right.name));
				}
				return f(right.name);
			case 'ArrayExpression':
				var array = resolveArrayExpression(right);
				return array;
			case 'BinaryExpression':
				climb(right).forEach(function (i) {
					if (i.type == 'Identifier') {
						if (isVarableASource(i.name)) {
							console.log('[BAD]'.red, name);
						}
					}
				});
				break;
			case 'CallExpression':
				var ce = resolveCallExpression(right);
				var ceName = f(ce.name);
				console.log('[CE]'.blue, pos(right), ce.name, ceName);
				isSink(ceName, function() {
					console.log('[SINK]'.red, pos(right), ceName);
				});

				return ce;
			case 'MemberExpression':
				var me = resolveMemberExpression(right);
				if (isVarableASource(me)) {
					console.log('[SOURCE]'.red, me);
				}
				return me;
			case 'ObjectExpression': // json objects
				return resolveObjectExpression(right);
			case 'FunctionExpression': // functions
				return resolveFunctionExpression(right);
		}
	}

	// designed to recursively resolve epressions
	function resolveExpression(node, parent) {
		switch (node.type) {
			case 'AssignmentExpression':
				var name = node.left.name;
				if (node.left.type == 'MemberExpression') {
					name = resolveMemberExpression(node.left);
					name = eval('vars.' + name);
				}
				
				vars[name] = resolveRight(node.right);

				console.log('[ASSIGN]'.blue, pos(node), name, vars[name]);
		
				break;
			case 'BinaryExpression':
				break;
		}
	}

	function resolveArrayExpression(node) {
		console.log('[ARRAY]'.green, pos(node));
		console.log(_.map(node.elements, resolveRight));
		return _.map(node.elements, resolveRight);
	}

	// turns a call expression into a simple json object
	function resolveCallExpression(node) {
		if (!node) // node can sometimes be undefined. Find out why later.
			return;
		var callExpression = {};
		if (node && node.type == 'CallExpression') {
			if (node.callee.type == 'MemberExpression') {
				callExpression.name = resolveMemberExpression(node.callee);
			} else {
				callExpression.name = node.callee.name;
			}
		}

		if (node.arguments.length > 0){
			callExpression.arguments = _.map(node.arguments, resolveRight);
		}
		callExpression.raw = callExpression.name +
			"(" + (callExpression.arguments ? callExpression.arguments.join(",") : "") + ")";

		return callExpression;
	}

	function resolveMemberExpression(node) {
		var b = resolveRight(node.property);
		b = node.computed ? '[' + b + ']' : '.' + b;
		if (node.object.type == 'MemberExpression') {
			return resolveMemberExpression(node.object) + b;
		} else if (node.object.type == 'CallExpression') {
			return resolveCallExpression(node.object).raw + b;
		} else {

			return node.object.name + b;
		}
	}

	function resolveObjectExpression(node) {
		console.log('[JSON]'.blue, pos(node));
		var obj = {};
		node.properties.forEach(function(i) {
			obj[i.key.name] = resolveRight(i.value);
			console.log(i.key.name, obj[i.key]);

		});
		return obj;
	}
 
	function resolveFunctionExpression(node) {
		var f = {
			name: node.id ? node.id.name : '',
			params: _.pluck(node.params, 'name'),
			body: node.body
		};
		return f;
	}

}

function isSink(name) {
	for (var i in sinks) {
		if (name.search(sinks[i]) === 0) {
			return true;
		}
	}
	return false;
}

function isVarableASource(name) {
	for (var i in sources) {
		if (name.indexOf(sources[i]) === 0) {
			return true;
		}
	}
	return false;
}

// Climbs through a binary expression and returns an array of the items. 
function climb(ast) {
	if (ast.type == 'BinaryExpression') {
		return climb(ast.left).concat(climb(ast.right));
	} else {
		return [ast];
	}
}

function pos(node) {
	return node.loc ? String(node.loc.start.line).grey : "-1".grey;
}

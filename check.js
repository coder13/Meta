var file = process.argv[2],
	colors = require('colors'),
	fs = require('fs'),
	path = require('path'),
	esprima = require('esprima'),
	estraverse = require('estraverse'),
	_ = require('underscore');

var input = fs.readFileSync(file);
var astInput = esprima.parse(input, {loc: true});

fs.writeFileSync("checkASTOutput.json",JSON.stringify(astInput));

var sinks = require('./danger.json').sinks,
	sources = ['userinput'], modules = [];

createNewScope(astInput, {}, []);

function createNewScope(ast, parentVars, params) {
	console.log('creating new scope'.red);
	var vars = parentVars;

	console.log(parentVars);

	function isSink(name, cb) {
		sinks.forEach(function (i) {
			if (name.match(i)) {
				cb();
			}
		});
	}

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
						isSink(ceName, function() {
							console.log('[SINK]'.red, pos(node), ceName);
						});
					
						if (vars[ce.name]) {
							var func = vars[ce.name];
							var args = _.object(func.params, ce.arguments);
							createNewScope(func.body, concat(vars, args));

						}

					}
						
					break;
				case 'ExpressionStatement':
					try {
						resolveExpression(node.expression, parent);
					
					} catch(e) {
						console.error(e);
						console.log(node)
					}
					break;
				case 'FunctionDeclaration':
					console.log(node);
					var func = resolveFunctionExpression(node);
					vars[func.name] = func;

					console.log('[FUNC]'.blue, pos(node), func.name, func);
					break;
				// default:
				// 	console.log(node);
				// 	break;
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

	function resolveRight(right) {
		// console.log('[RIGHT]'.blue, pos(right), right);
		switch (right.type) {
			case 'Literal':
				// If right.value is bad, mark variable as bad
				return right.value;
				
			case 'Identifier':
				// if variable is being set to a bad variable, mark it too as bad
				// if (isVarableASource(right.name)) {
				//	sources.push(name);
				//	console.log('[BAD]'.red, name);
				// }
				return f(right.name);
				break;
			case 'ArrayExpression':
				var array = resolveArrayExpression(right);
				return array;
				break;
			case 'BinaryExpression':
				// climb(right).forEach(function (i) {
				// 	if (i.type == 'Identifier') {
				// 		if (isVarableASource(i.name)) {
				// 			sources.push(name);
				// 			console.log('[BAD]'.red, name);
				// 		}
				// 	}
				// });
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
				// console.log(resolveMemberExpression(right));
				return resolveMemberExpression(right);
			case 'ObjectExpression': // json objects
				return resolveObjectExpression(right);
				
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
			
			// console.log(node.callee.name);
			if (node.callee.type == 'MemberExpression') {
				cName = node.callee.object.name;
				
				callExpression.name = resolveMemberExpression(node.callee);
				// console.log(callExpression.name);
			} else {
				callExpression.name = node.callee.name;
			}
		}

		if (node.arguments.length > 0)
			callExpression.arguments = simplifyArguments(node.arguments);

		callExpression.raw = callExpression.name +
			"(" + (callExpression.arguments ? callExpression.arguments.join(",") : "") + ")";

		return callExpression;
	}

	function resolveMemberExpression(node) {
		if (node.object.type == 'MemberExpression') {
			return resolveMemberExpression(node.object) + '.' + node.property.name;
		} else {
			return node.object.name + '.' + node.property.name;
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

	function simplifyArguments(args) {
		var newArgs = [];
		args.forEach(function (i) {
			switch (i.type) {
				case 'Literal':
					newArgs.push("'" + i.value + "'");
					break;
				case 'Identifier':
					newArgs.push(i.name);
					break;
				case 'CallExpression':
					newArgs.push(resolveCallExpression(i));
					break;
				case 'FunctionExpression':
					var func = resolveFunctionExpression(i);
					newArgs.push(func);
					createNewScope(func.body, func.params);
					console.log('[FUNC]'.blue, pos(i), func);
					break;
				// default:
				//	console.log(i.type, i);
			}
		});
		return newArgs;
	}

}

function isVarableASource(name) {
	return sources.indexOf(name) > -1;
}

function climb(ast) {
	if (ast.type == 'BinaryExpression') {
		return climb(ast.left).concat(climb(ast.right));
	} else {
		return [ast];
	}
}

function concat(a,b) {
	c = {};
	for (var key in a) {
		c[key] = a[key];
	}
	for (var key in b) {
		c[key] = b[key];
	}
	return c;
}

function pos(node) {
	return node.loc ? String(node.loc.start.line).grey : "-1".grey;
}

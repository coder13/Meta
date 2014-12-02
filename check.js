var file = process.argv[2],
	colors = require('colors'),
	fs = require('fs'),
	path = require('path'),
	esprima = require('esprima'),
	estraverse = require('estraverse');

var input = fs.readFileSync(file);
var astInput = esprima.parse(input);

var sinks = require('./danger.json').sinks,
	sources = ['userinput'], modules = [];

createNewScope(astInput);

function createNewScope(ast) {
	console.log('creating new scope'.black);
	var vars = [];

	estraverse.traverse(ast, {
		enter: function (node, parent) {
			// console.log(node);
			switch (node.type) {
				case 'VariableDeclarator':
					if (node.init) {
						track(this, node);
					}
					break;
				case 'CallExpression':
					case 'CallExpression':
						ce = resolveCallExpression(this, node);
						var ceName = f(this, ce.name);
						console.log(String(ce.raw).green);
						
						// determine if expression is a sink. Then report.
						sinks.forEach(function (i) {
							if (ceName.match(i)) {
								console.log('[SINK]'.red, ce.raw);
								return;
							} else if (ceName.indexOf("fs") != -1) {
							}
						});
					break;
				case 'ExpressionStatement':
					resolveExpression(this, node.expression);
					break;
			}

		}
	});


	function track(variable) {

		var varName = variable.id.name;
		switch (variable.init.type) {
			case 'Literal':
				// If variable.init.value is bad, mark variable as bad
				vars[varName] = variable.init.value;
				break;
			case 'Identifier':
				// if variable is being set to a bad variable, mark it too as bad
				if (isVarableASource(variable.init.name)) {
					sources.push(varName);
					console.log('[BAD]'.red, varName);
				}
				break;
			case 'BinaryExpression':
				climb(variable.init).forEach(function (i) {
					if (i.type == 'Identifier') {
						if (isVarableASource(i.name)) {
							sources.push(varName);
							console.log('[BAD]'.red, varName);
						}
					}
				});
				break;
			case 'CallExpression':
				vars[varName] = resolveCallExpression(variable.init);
				break;
			case 'MemberExpression':
				vars[varName] = resolveCallExpression(variable.init.object).raw + '.' + variable.init.property.name;
				break;
		}

		console.log('[VAR]'.blue, varName, vars[varName]);
		
	}

	function f(name) { // rename later; returns a value for a variable if one exists
		return vars[ce.name] ? (f(vars[ce.name]) || name) : name;
	}

	// designed to recursively resolve epressions
	function resolveExpression(node) {
		switch (node.type) {
			case 'AssignmentExpression':
				if (node.right.type == 'Literal')
					vars[node.left.name] = node.right.name;
				else if (node.right.type == 'CallExpression') {
					vars[node.left.name] = resolveExpression(node.right);
				}
				console.log('[ASSIGN]'.blue, node.left.name, vars[String(node.left.name)]);
		
				break;
			case 'CallExpression':
				// ce = resolveCallExpression(node);
				// var ceName = f(ce.name);
				// console.log(String(ce.name).green);
				
				// // determine if expression is a sink. Then report.
				// sinks.forEach(function (i) {
				// 	if (ceName.match(i)) {
				// 		console.log(ceName, i);
				// 		console.log('[SINK]'.red, ce.raw);
				// 		return;
				// 	} else if (ceName.indexOf("fs") != -1) {
				// 		console.log("--".red);
				// 	}
				// });
				// return ce;
			case 'BinaryExpression':
				break;
		}
	}


	// turns a call expression into a simple json object
	function resolveCallExpression(ce) {
		if (!ce) // ce can sometimes be undefined. Find out why later.
			return;
		var callExpression = {};
		if (ce && ce.type == 'CallExpression') {
			
			// console.log(ce.callee.name);
			if (ce.callee.type == 'MemberExpression') {
				cName = ce.callee.object.name;
				
				callExpression.name = (vars[cName] ? vars[cName].raw : cName) +
				'.' + ce.callee.property.name;
			} else {
				callExpression.name = ce.callee.name;
			}
		}

		if (ce.arguments)
			callExpression.arguments = simplifyArguments(ce.arguments);

		callExpression.raw = callExpression.name +
			"(" + (callExpression.arguments ? callExpression.arguments.join(",") : "") + ")";

		return callExpression;
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
					createNewScope(i);
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

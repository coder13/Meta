var file = process.argv[2],
	colors = require('colors'),
	fs = require('fs'),
	path = require('path'),
	esprima = require('esprima'),
	estraverse = require('estraverse');

var input = fs.readFileSync(file);
var astInput = esprima.parse(input, {loc: true});

// var astInput = esprima.parse(input, {loc: true, tokens: true});

fs.writeFileSync("checkASTOutput.json",JSON.stringify(astInput));

var sinks = require('./danger.json').sinks,
	sources = ['userinput'], modules = [];

createNewScope(astInput, []);

function createNewScope(ast, parentVars) {
	console.log('creating new scope'.red);
	var vars = parentVars;

	function isSink(name, cb) {
		sinks.forEach(function (i) {
			if (name.match(i)) {
				cb();
			}
		});
	}

	estraverse.traverse(ast, {
		enter: function (node, parent) {
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
						console.log('[FUNC]'.blue, pos(node), ce.name, f(ce.name));
						isSink(ceName, function() {
							console.log('[SINK]'.red, pos(node), ceName);
						});
					}
						
					break;
				case 'ExpressionStatement':
					resolveExpression(node.expression);
					break;
			}

		}
	});

	// handles creation of variables. 
	function track(variable) {
		// console.log(variable);
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
				vars[varName] = f(variable.init.name);
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
				// console.log(resolveMemberExpression(variable.init));
				switch (variable.init.type){
					case 'MemberExpression':
						vars[varName] = resolveMemberExpression(variable.init);
						break;
				}
				break;
			case 'ObjectExpression': // json objects
				vars[varName] = resolveObjectExpression(variable.init);
				break;
		}

		console.log('[VAR]'.blue, pos(variable),  varName, vars[varName]);
		
	}

	function f(name) { // rename later; returns a value for a variable if one exists
		var s = name.indexOf('.') == -1 ? name : name.split('.').slice(0,-1).join('.');
		return vars[s] ? name.replace(s, vars[s].raw) : name;
	}

	// designed to recursively resolve epressions
	function resolveExpression(node) {
		switch (node.type) {
			case 'AssignmentExpression':
				var name = node.left.name;
				if (node.left.type == 'MemberExpression') {
					name = resolveMemberExpression(node.left);
				}
				
				if (node.right.type == 'Literal')
					vars[name] = node.right.name;
				else if (node.right.type == 'CallExpression') {
					vars[name] = resolveExpression(node.right);
				}
				console.log('[ASSIGN]'.blue, pos(node), name, vars[String(node.left.name)]);
		
				break;
			case 'BinaryExpression':
				break;
		}
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
		console.log('[JSON]', node.properties);

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
					// createNewScope(i, vars);
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

function pos(node) {
	return String(node.loc.start.line).red;
}

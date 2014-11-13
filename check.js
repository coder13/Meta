var file = process.argv[2],
	colors = require('colors'),
	fs = require('fs'),
	path = require('path'),
	esprima = require('esprima'),
	estraverse = require('estraverse');

var input = fs.readFileSync(file);
var ast = esprima.parse(input);

var syncs = require('./danger.json').syncs;
var vars = [], sources = ['userinput'], modules = [];

// console.log(ast);

estraverse.traverse(ast, {
	enter: function (node, parent) {
		// console.log(node);
		switch (node.type) {
			case 'VariableDeclarator':
				if (node.init) {
					track(node);
				}
				break;
			case 'CallExpression':
				break;
			case 'ExpressionStatement':
				resolveExpression(node.expression);
				break;
		}
	}
});

var out = fs.createWriteStream('output.json');

out.write(JSON.stringify(ast));
out.end();

// console.log(vars);

function isBad(name) {

	return sources.indexOf(name) > -1;
}

function climb(ast) {
	if (ast.type == 'BinaryExpression') {
		return climb(ast.left).concat(climb(ast.right));
	} else {
		return [ast];
	}
}

function track(variable) {
	switch (variable.init.type) {
		case 'Literal':
			// If variable.init.value is bad, mark variable as bad
			vars[String(variable.id.name)] = variable.init.value;
			break;
		case 'Identifier':
			// if variable is being set to a bad variable, mark it too as bad
			if (isBad(variable.init.name)) {
				sources.push(variable.id.name);
				console.log('found bad variable: ' + variable.id.name);
			}
			break;
		case 'BinaryExpression':
			climb(variable.init).forEach(function (i) {
				if (i.type == 'Identifier') {
					if (isBad(i.name)) {
						sources.push(variable.id.name);
						console.log('found bad variable: ' + variable.id.name);
					}
				}
			});
			break;
		case 'CallExpression':
			vars[String(variable.id.name)] = resolveCallExpression(variable.init);
			break;
		case 'MemberExpression':
			vars[String(variable.id.name)] =
	resolveCallExpression(variable.init.object).raw + '.' + variable.init.property.name;
			break;
	}

	console.log('[VAR]', variable.id.name, vars[String(variable.id.name)]);
	
}

function resolveExpression(node) {
	switch (node.type) {
		case 'AssignmentExpression':
			if (node.right.type == 'Literal')
				vars[node.left.name] = node.right.name;
			else if (node.right.type == 'CallExpression') {
				vars[node.left.name] = resolveExpression(node.right);
			}
			break;
		case 'CallExpression':
			ce = resolveCallExpression(node);
			if (ce.raw.indexOf('require(\'fs\')') > -1) {
				console.log("Something");
			}
			if (vars.indexOf(ce.name) != -1) {
				if (syncs.indexOf(vars[ce.name]) >= 0) { // BAD.
					console.log('[BAD]', ce.raw);
				}
			} else {
				if (syncs.indexOf(ce.name) >= 0) { // BAD. 
					console.log('[BAD]', ce.raw);
				}
			}
			return ce;
		case 'BinaryExpression':
			break;
	}
}

function resolveCallExpression(ce) {
	if (!ce) // ce can sometimes be undefined. Find out why later.
		return;
	var callExpression = {};
	if (ce && ce.type == 'CallExpression') {
		
		cObj = ce.callee.object;
		if (ce.callee.type == 'MemberExpression') {
			console.log(cObj);
			callExpression.name = (vars.indexOf(cObj.name) > -1 ? (vars[cObj.name].raw || vars[cObj.name].name)  + '.' : cObj.name)
					+ ce.callee.property.name;
		} else
			callExpression.name = ce.callee.name;
		
	}
	if (ce.arguments)
		callExpression.arguments = simplifyArguments(ce.arguments);
	callExpression.raw = callExpression.name +
		"(" + (callExpression.arguments ? callExpression.arguments.join() : "") + ")";

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
		}
	});
	return newArgs;
}
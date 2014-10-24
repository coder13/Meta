var file = process.argv[2],
	colors = require('colors'),
	fs = require('fs'),
	path = require('path'),
	esprima = require('esprima'),
	estraverse = require('estraverse');

var input = fs.readFileSync(file);
var ast = esprima.parse(input);

var dangerFunctions = ['eval', 'setTimeout', 'clearTimeout', 'setInterval', 'clearInterval'];
var vars = [], badVars = ['userinput'];

console.log(ast);

estraverse.traverse(ast, {
	enter: function (node) {
		if (node.type == 'VariableDeclarator' && node.init) {
			track(node);
		}

		if (node.type == 'CallExpression') {
			if (dangerFunctions.indexOf(node.callee.name) > -1) {

				if (node.arguments[0].type == 'Identifier') {
					if (isBad(node.arguments[0].name));
						console.log('[BAD]', node.callee.name, node.arguments[0].name );
				} else if (node.arguments[0].type == 'BinaryExpression') {
					
					climb(node.arguments[0]).forEach(function (i) {
						if (isBad(i.name))
							console.log('[BAD]', node.callee.name, i.name);
					});
				}
			}
		}
	}
});

var out = fs.createWriteStream('output.json');

out.write(JSON.stringify(ast));
out.end();

function isBad(name) {

	return badVars.indexOf(name) > -1;
}

function climb(ast) {
	if (ast.type == 'BinaryExpression') {
		return climb(ast.left).concat(climb(ast.right));
	} else {
		return [ast];
	}
}

function track(variable) {
	if (variable.init.type == 'Literal') {
		// If variable.init.value is bad, mark variable as bad
		vars[String(variable.id.name)] = variable.init.value;

	} else if (variable.init.type == 'Identifier') {

		// if variable is being set to a bad variable, mark it too as bad
		if (isBad(variable.init.name)) {
			badVars.push(variable.id.name);
			console.log('found bad variable: ' + variable.id.name);
		}

	} else if (variable.init.type == 'BinaryExpression') {
		climb(variable.init).forEach(function (i) {
			if (i.type == 'Identifier') {
				if (isBad(i.name)) {
					badVars.push(variable.id.name);
					console.log('found bad variable: ' + variable.id.name);
				}
			}
		});
	} else if (variable.init.type == 'CallExpression' && variable.init.callee == 'require') {
		if (variable.init.arguments[0].type == 'Literal' && variable.init.arguments[0].name == 'child_process') {
			badVars.push(variable.id.name);

		}
		console.log(variable);
	}
	
}
var c = 'colors';

var file = process.argv[2],
	colors = require(c),
	fs = require('fs'),
	esprima = require('esprima'),
	estraverse_asd = require('estraverse');

console.log(('processing ' + file + '\n').blue);
input = fs.readFileSync(file);
ast = esprima.parse(input);

var variables = {};

console.log('this file requires: '.green);
estraverse_asd.traverse(ast, {

	enter: function (node) {
		if (node.type == 'VariableDeclarator') {
			if (node.init.type == 'Literal') {
				variables[String(node.id.name)] = node.init.value;
			}
		}
		if (node.type == 'CallExpression' && node.callee.name == 'require') {
			if (node.arguments[0].type == 'Literal') {
				console.log('-', String(node.arguments[0].value).blue);
			} else if (node.arguments[0].type == 'Identifier') {
				console.log('-', String(variables[node.arguments[0].name]).blue);
			}
		}
	}
});
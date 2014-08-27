var c = 'colors';

var file = process.argv[2],
	colors = require(c),
	fs = require('fs'),
	esprima = require('esprima'),
	estraverse_asd = require('estraverse');

console.log(('processing ' + file + '\n').blue);
input = fs.readFileSync(file);
ast = esprima.parse(input);

console.log('this file requires: '.green);
estraverse_asd.traverse(ast, {

	enter: function (node) {
		if (node.type == 'VariableDeclaration') {
			console.log(JSON.stringify(node).red);
		}
		if (node.type == 'CallExpression' && node.callee.name == 'require') {
			console.log('-', String(node.arguments[0].value).blue);
		}
	}
});


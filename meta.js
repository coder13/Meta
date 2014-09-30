var file = process.argv[2],
	colors = require('colors'),
	fs = require('fs'),
	esprima = require('esprima'),
	estraverse = require('estraverse'),
	curdir = String(process.cwd() + '/' + process.argv[2]).split('/').slice(0, -1).join('/');

console.log(curdir.green);

require('hapi');

// console.log(require.resolve('hapi'));
var requires = {};

function getRequires(file, scope) {
	// console.log(file.green);

	// console.log(('processing ' + file + '\n').blue);

	scope = scope||'-';

	var input = fs.readFileSync(file),
		vars = {},
		req = {};
	var ast = esprima.parse(input);
	estraverse.traverse(ast, {
		enter: function (node) {
			if (node.type == 'VariableDeclarator' && node.init) {
				if (node.init.type == 'Literal') {
					vars[String(node.id.name)] = node.init.value;
				}
			}
			if (node.type == 'CallExpression' && node.callee.name == 'require') {
				var p;
				if (node.arguments[0].type == 'Literal') {
					p = node.arguments[0].value;
				} else if (node.arguments[0].type == 'Identifier') {
					p = vars[node.arguments[0].name];
				}

				// console.log(p);
				if (p && require.resolve(p) != p) {
					// console.log(require.resolve(p).red);
					console.log(String(scope).black + String(p).blue);
					req[p] = getRequires(require.resolve(p), scope+'-');
				}
			}
		}
	});

	return req;

}

function resolve(pkg) {
	var s = plg.split('.');
	// check if file exists as js file
	if (s[s.length-1] == 'js' ? true : (fs.exists(pkg) || fs.exists(pkg + ".js"))) {
		
	} else {
		 
	}
}

requires = getRequires(file);
console.log(requires);
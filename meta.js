var mainFile = process.argv[2],
	colors = require('colors'),
	fs = require('fs'),
	path = require('path'),
	esprima = require('esprima'),
	estraverse = require('estraverse'),
	resolve = require('resolve');
	curdir = String(process.cwd() + '/' + process.argv[2]).split('/').slice(0, -1).join('/');

console.log(curdir.white);

require('hapi');

var lookuptable = {},
	requires = {};

function getRequires(file, scope) {
	curdir = String(file).split('/').slice(0, -1).join('/');

	scope = scope||' -- ';

	var input = fs.readFileSync(file),
		vars = {},
		req = {};
	
	cd = JSON.parse(JSON.stringify(curdir));
	
	function _resolve(p) {
		if (!resolve.isCore(p)) {
			var fullPath = resolve.sync(p, {basedir: String(file).split('/').slice(0, -1).join('/')});
			try  {

				if (!lookuptable[fullPath]) {
					lookuptable[fullPath] = true;

					console.log(String(scope).black + String(p).blue);
					req[p] = getRequires(fullPath, scope + ' -- ');
				}
			} catch (e) {
				
				console.error(e);
				
			}
		}
	}
	
	if (path.extname(file) == '.json') {
		input = JSON.parse(input);
		if (Array.isArray(input)) {
			input.forEach(function(i) {
				_resolve(i);
			});
		
		}
	}

	var ast = esprima.parse(input);
	estraverse.traverse(ast, {
		enter: function (node) {
			if (node.type == 'VariableDeclarator' && node.init) {
				if (node.init.type == 'Literal') {
					vars[String(node.id.name)] = node.init.value;
				}
			}
			if (node.type == 'CallExpression' && node.callee.name == 'require') {
				var pkg;
				if (node.arguments[0].type == 'Literal') {
					pkg = node.arguments[0].value;
				} else if (node.arguments[0].type == 'Identifier') {
					pkg = vars[node.arguments[0].name];
				}

				if (pkg) { // pkg can sometimes be undefind. 

					_resolve(pkg);
				}
			}
		}
	});

	return req;

}

function pop(path, l) {
	return path.split('/').slice(0,-(l || 1)).join('/');
}

requires = getRequires(mainFile);
console.log(requires);

var file = process.argv[2],
	colors = require('colors'),
	fs = require('fs'),
	esprima = require('esprima'),
	estraverse = require('estraverse'),
	curdir = String(process.cwd() + '/' + process.argv[2]).split('/').slice(0, -1).join('/');

hapi = require('hapi');

console.log(curdir.green);

var requires = {};

function getRequires(file, scope) {
	curdir = file.split('/').slice(0, -1).join('/');
	console.log(curdir.green);

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
				var pkg;
				if (node.arguments[0].type == 'Literal') {
					pkg = node.arguments[0].value;
				} else if (node.arguments[0].type == 'Identifier') {
					pkg = vars[node.arguments[0].name];
				}

				console.log(String(pkg));
				// Do we actually have a package we are looking at
				if (pkg) {
					// Try to load it. If node can't find it, we try a different approach
					try {
						if (require.resolve(pkg) != pkg){
							// console.log(require.resolve(pkg).red);
							console.log(scope, pkg);
							req[pkg] = getRequires(resolve(pkg), scope+'-');
						}
					} catch (err) {
						// Assume it's a folder
						if (pkg[0] == "." && pkg[1] == "/") {
							curdir += pkg.slice(1);
							console.log(scope, 'index.js');
							req['index.js'] = getRequires(resolve('index.js'), scope+'-');
						} else {
							console.log(String(pkg).red);
						}
					}
				}
			}
		}
	});

	return req;

}

function resolve(pkg) {
	var s = pkg.split('.');
	if (pkg[0] == '.') {
		if (s[s.length-1] == 'js' ? true : (fs.exists(pkg) || fs.exists(pkg + ".js"))) {
		}
			 console.log(pkg.orange);
	}
	return require.resolve(pkg, {basedir: curdir});
}

requires = getRequires(file);
console.log(JSON.stringify(requires));
var mainFile = process.argv[2],
	colors = require('colors'),
	fs = require('fs'),
	path = require('path'),
	esprima = require('esprima'),
	estraverse = require('estraverse'),
	resolve = require('resolve');
	curdir = String(process.cwd() + '/' + process.argv[2]).split('/').slice(0, -1).join('/');

<<<<<<< HEAD
console.log(curdir.white);
=======
hapi = require('hapi');
>>>>>>> 8647aa17eab342e82bc1d0b5a638d806964fac8b

console.log(curdir.green);

<<<<<<< HEAD
var lookuptable = {},
	requires = {};

function getRequires(file, scope) {
	curdir = String(file).split('/').slice(0, -1).join('/');
=======
var requires = {};

function getRequires(file, scope) {
	curdir = file.split('/').slice(0, -1).join('/');
	console.log(curdir.green);
>>>>>>> 8647aa17eab342e82bc1d0b5a638d806964fac8b

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

<<<<<<< HEAD
				if (pkg) { // pkg can sometimes be undefind. 

					_resolve(pkg);
=======
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
>>>>>>> 8647aa17eab342e82bc1d0b5a638d806964fac8b
				}
			}
		}
	});

	return req;

}

<<<<<<< HEAD
function pop(path, l) {
	return path.split('/').slice(0,-(l || 1)).join('/');
}

requires = getRequires(mainFile);
console.log(requires);
=======
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
>>>>>>> 8647aa17eab342e82bc1d0b5a638d806964fac8b

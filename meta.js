var mainFile = process.argv[2],
	colors = require('colors'),
	fs = require('fs'),
	path = require('path'),
	esprima = require('esprima'),
	estraverse = require('estraverse'),
	resolve = require('resolve'),
	util = require('util');
	curdir = String(process.cwd() + '/' + process.argv[2]).split('/').slice(0, -1).join('/');

console.log(curdir.grey);

require('hapi');

// console.log(resolve.sync('hapi'));
var requires = {},
	pNode_Modules = "";

function getRequires(file, scope, isModule) {
	curdir = String(file).split('/').slice(0, -1).join('/');
	pNode_Modules = String(file).split('/').slice(0, String(file).split('/').lastIndexOf('node_modules')+1).join('/');
	// console.log(curdir.blue);

	// console.log(('processing ' + file + '\n').grey);

	scope = scope||' -- ';

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

				console.log(p);

				if (p) { // P can sometimes be undefind. 

					if (!resolve.isCore(p)) {
						if (p[0] == '.') { // Is a file / directory
							var fullPath = path.normalize(curdir + '/' + p);
							
				// console.log(String(fullPath).white);
							if (fs.existsSync(fullPath + '/index.js')) { // Is directory if there is an /index.js
								console.log(String(scope).black + String(p).blue);
								req[p] = getRequires(fullPath + '/index.js', scope + ' -- ', false);
							
							} else if (fs.existsSync(fullPath)) { // Is file without extension?
								console.log(String(scope).black + String(p).blue);
								req[p] = getRequires(fullPath, scope + ' -- ', false);
								
							} else if (fs.existsSync(fullPath + '.js')) { // Is file with extension?
								console.log(String(scope).black + String(p).blue);
								req[p] = getRequires(fullPath + '.js', scope + ' -- ', false);

							}

						} else {
							// console.log(curdir.red);
							try  {
								console.log(String(scope).black + String(p).blue);
								req[p] = getRequires(resolve.sync(path.normalize(p), {basedir: curdir}), scope + ' -- ', true);
							} catch (e) {
								
								console.error(e);
								
							}
						}
					}
				}
			}
		}
	});

	return req;

}

function pop(path, l) {
	return path.split('/').slice(0,-(1 || l)).join('/');
}

// function resolve(pkg) {
// 	var s = plg.split('.');
// 	// check if file exists as js file
// 	if (s[s.length-1] == 'js' ? true : (fs.exists(pkg) || fs.exists(pkg + ".js"))) {
		
// 	}
// }

requires = getRequires(mainFile);
// console.log(requires);
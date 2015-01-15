/*
	;(function() {eval(String(require('fs').readFileSync(process.argv[1])));})()
*/

var colors = require('colors'),
	fs = require('fs'),
	path = require('path'),
	esprima = require('esprima'),
	estraverse = require('estraverse'),
	_ = require('underscore'),
	resolve = require('resolve'),
	path = require('path'),
	hapi = require('hapi');
	flags = {verbose: false};

sinks = module.exports.sinks = require('./danger.json').sinks;
sources = module.exports.sources = require('./danger.json').sources;

var lookupTable = {};

var custom = [function(node, scope) { // http.get
	// assertions
	var name = scope.resolveName(node.callee); // We only want to get the name;
	if (name != 'require(\'http\').get') {
		return;
	}
	
	var ce = scope.resolveCallExpression(node);
	var func = ce.arguments[1];

	func.scope.sources = func.scope.sources.concat(func.params[0]);
	traverse(func.body, func.scope);

}, function(node, scope) { // require
	var name = scope.resolveName(node.callee);
	if (name != 'require')
		return;

	// var ce = scope.resolveCallExpression(node);
	if (node.arguments[0].type == 'Literal') {
		var file = node.arguments[0].value;
		console.log(file, scope.file);
		scope.resolvePath(file, function (pkg) {
			if (!pkg)
				return;

			if (lookupTable[pkg])
				return;
			else {
				lookupTable[pkg] = true;

				var ast = astFromFile(pkg);
				if (ast) {
					console.log(' ---- '.yellow, pkg);
					var newScope = new Scope({sources: sources, file:pkg});
					console.log(file, newScope);
					traverse(ast, newScope);
				} else {
					console.log(' ---- '.yellow, String(pkg).red);
				}
			}
		});
	}

}];


var self;

Scope = function(scope) {
	this.vars = scope.vars || {};
	if (!this.vars.module) this.vars.module = {};
	if (!this.vars.global) this.vars.global = {};
	if (!this.vars.process) this.vars.process = {};
	this.sources = scope.sources||[];
	this.file = scope.file;
	self = this;
};

// handles creation of variables. 
Scope.prototype.track = function(variable) {
	// console.log(variable);
	var name = variable.id.name;

	var value = self.resolveRight(variable.init, function(extra) {
		self.sources.push(name);
		console.log('[SOURCE]'.red, pos(variable).grey, name);
	});

	self.vars[name] = value;

	if (flags.verbose)
		console.log('[VAR]'.blue, pos(variable).grey, name, value);
	
};

// returns a value for a variable if one exists
Scope.prototype.resolve = function(name) {
	if (self.vars[name])
		return self.vars[name];
	try {
		var s = name.indexOf('.') == -1 ? name : name.split('.').slice(0,-1).join('.');
		return self.vars[s] ? name.replace(s, self.vars[s].raw||self.vars[s]) : name;
	} catch (e) {
		return name;
	}
};

// Resolves variables and returns a simplifed version. 
Scope.prototype.resolveRight = function(right, isSourceCB) {
	if (!right){
		return;
	}
	switch (right.type) {
		case 'Literal':
			return right.raw;
		case 'Identifier':
			// if variable is being set to a bad variable, mark it too as bad

			var resolved = self.resolve(right.name);
			if (resolved && typeof resolved == 'String') {
				if (self.isSource(resolved.name)) {
					if (isSourceCB)
						isSourceCB();
				}
			}
			return self.resolve(right.name);
		case 'ArrayExpression':
			var array = self.resolveArrayExpression(right);
			if (flags.verbose)
				console.log('[ARRAY]'.blue, pos(right).grey, array);
			return array;
		case 'BinaryExpression':
			climb(right).forEach(function (i) {
				if (i.type == 'Identifier') {
					if (self.isSource(i.name)) {
						if (isSourceCB)
							isSourceCB(i.name);
					}
				}
			});
			return right;
		case 'CallExpression':
			var ce = self.resolveCallExpression(right);
			if (!ce.name)
				return ce;
			var ceName = self.resolve(ce.name).name || self.resolve(ce.name) || ce.name;

			if (flags.verbose)
				console.log('[CE]'.green, pos(right).grey, ceName, ce.raw);


			if (self.isSource(ceName || ce.name)) {
				if (isSourceCB)
					isSourceCB(ceName);
			}

			if (isSink(ceName)) {
				console.log('[SINK]'.red, pos(right).grey, ceName);
			}

			return ce;
		case 'MemberExpression':
			var me = self.resolveMemberExpression(right);
			if (typeof me == "string" && self.isSource(me)) {
				if (isSourceCB)
					isSourceCB();
			}
			return me;
		case 'ObjectExpression': // json objects
			return self.resolveObjectExpression(right);
		case 'FunctionExpression': // functions
			var fe = self.resolveFunctionExpression(right);
			traverse(fe.body, fe.scope);
			return fe;
		default:
			// console.log(String(right.type).green);
			return;
	}
};

Scope.prototype.resolveArrayExpression = function(node, isSourceCB) {
	return _.map(node.elements, function(right) {
		return self.resolve(self.resolveRight(right), isSourceCB);
	});
};

// turns a call expression into a simple json object
Scope.prototype.resolveCallExpression = function(node) {
	if (!node) // node can sometimes be undefined. Find out why later.
		return;
	var ce = {};
	if (node && node.type == 'CallExpression') {
		// console.log('callee', node.callee);
		// if (node.object.type != 'BinaryExpression')
		ce.name = self.resolveName(node.callee);
	}

	if (node.arguments && node.arguments.length > 0){
		_resolveRight = function(right) {
			return self.resolveRight(right, function() {});
		};
		ce.arguments = _.map(node.arguments, _resolveRight);
	}
	ce.raw = ce.name +
		"(" + (ce.arguments ? ce.arguments.join(",") : "") + ")";


	custom.forEach(function(i) {
		i(node, scope); // result
	});

	return ce;
};

Scope.prototype.resolveForStatement = function(node) {
	var fs = {};
	/* in ECMAScript 5 for statements do not create their own scope, 
	 * so create a variable, then track it in current scope */
	if (node.init && node.init.declarations)
		for (var i = 0; i < node.init.declarations.length; i++) {
			var v = node.init.declarations[i];
			self.track(v);
		}
	test = self.resolveRight(node.test);
	if (flags.verbose)
		console.log('[TEST]'.blue, pos(node).grey, test);

	traverse(node.body, scope);
	return fs;
};

Scope.prototype.resolveWhileStatement = function(node) {
	var ws = {};
	test = self.resolveRight(node.test);
	if (flags.verbose)
		console.log('[TEST]'.blue, pos(node).grey);
	
	traverse(node.body, self);
	return ws;
};

Scope.prototype.resolveName = function(name) {
	if (name.type == 'MemberExpression') {
		return self.resolveMemberExpression(name);
	} else {
		return name.name;
	}
};

Scope.prototype.resolveMemberExpression = function(node) {
	var i = self.resolveRight(node.property);
	b = node.computed ? '[' + i + ']' : '.' + i;
	if (node.object.type == 'MemberExpression') {
		return self.resolveMemberExpression(node.object) + b;
	} else if (node.object.type == 'CallExpression') {
		return self.resolveCallExpression(node.object).raw + b;
	} else if (node.object.type == 'Identifier') {
		return self.resolve(node.object.name)[i] || node.object.name + b;
	} else if (node.object.type == 'Literal') {
		return false;
	}
};

Scope.prototype.resolveObjectExpression = function(node) {
	var obj = {};
	node.properties.forEach(function(i) {
		obj[i.key.name] = self.resolveRight(i.value);

	});
	return obj;
};

Scope.prototype.resolveFunctionExpression = function(node) {
	var fe = {
		name: node.id ? node.id.name : '',
		params: _.pluck(node.params, 'name'),
		body: node.body
	};

	fe.scope = new Scope(self);
	for (var i in fe.params) {
		fe.scope.addVar(fe.params[i], undefined);
	}

	traverse(fe.body, fe.scope);

	return fe;
};

Scope.prototype.resolvePath = function(file, cb) {
	var pkg;
	if (file.indexOf('./') === 0 || file.indexOf('../') === 0) {
		if (path.extname(file) == '.json') {
			// input = JSON.parse(input);
			// if (Array.isArray(input)) {
			//	input.forEach(cb);
			// }
			return false;
		}
	}

	try {
		console.log(this.file);
		pkg = resolve.sync(file, {basedir: String(this.file).split('/').slice(0,-1).join('/')});
		if (file == pkg)
			return false;
		else if (pkg)
			return cb(pkg);
	} catch (e) {
		console.error(String(e).red);
		return false;
	}
};

Scope.prototype.addVar = function(name, value) {
	self.vars[name] = value;
};

isSink = module.exports.isSink = function(name) {
	for (var i in sinks) {
		if (name.search(sinks[i]) === 0) {
			return true;
		}
	}
	return false;
};

Scope.prototype.isSource = function(name) {
	for (var i in self.sources) {
		if (name.search(self.sources[i]) === 0) {
			return true;
		}
	}
	return false;
};

module.exports.Scope = Scope;

traverse = module.exports.traverse = function(ast, scope) {
	
	estraverse.traverse(ast, {
		enter: function (node, parent) {
			if (node.type == 'Program' || node.type == 'BlockStatement') {
				if (flags.verbose) {
					console.log('Creating new scope'.yellow);
					console.log('[SOURCES]'.red, scope.sources);
				}
			}

			// traverse top level expressions only
			if (parent && parent.type != 'Program' && parent.type != 'BlockStatement') {
				this.skip();
				// return;
			}

			switch (node.type) {
				case 'VariableDeclarator':
					scope.track(node);
					break;
				case 'CallExpression':
					ce = scope.resolveCallExpression(node);
					if (!ce.name) {
						break;
					}
					var ceName = scope.resolve(ce.name).name || ce.name || scope.resolve(ce.name);

					if (flags.verbose)
						console.log('[CE]'.blue, pos(node).grey, ceName, ce.raw);


					if (ceName) {
						if (isSink(ceName)) {
							console.log('[SINK]'.red, pos(node).grey, ceName);
						}
					}

					if (scope.vars[ce.name]) {
						var func = scope.vars[ce.name];
						var args = _.object(func.params, ce.arguments);
						// createNewScope(func.body, _.extend(scope.vars, args));
					}
					break;
				case 'AssignmentExpression':
					var name = self.resolve(self.resolveName(node.left));
					var value = self.resolve(self.resolveRight(node.right, function(extra) {
						self.sources.push(name);
						console.log('[SOURCE]'.red, pos(node).grey, name);
					}));
					// if (node.left.type == 'MemberExpression') {
					//	name = self.resolveMemberExpression(node.left);
					//	name = eval('self.vars.' + name);
					// }
					
					if (self.vars[name]) {
						self.vars[name] = value;
					}

					if (flags.verbose)
						console.log('[ASSIGN]'.blue, pos(node).grey, name, value);
					break;
				case 'FunctionDeclaration':
					// console.log(node);
					var func = scope.resolveFunctionExpression(node);
					scope.vars[func.name] = func;


					if (flags.verbose)
						console.log('[FUNC]'.blue, pos(node).grey, func.name);
					break;
				case 'IfStatement':
					test = self.resolveRight(node.test);
					if (flags.verbose)
						console.log('[TEST]'.blue, pos(node).grey, test);

					traverse(node.consequent, self);
					break;
				case 'ForStatement':
					var fs = self.resolveForStatement(node);
					break;
				case 'WhileStatement':
					var ws = self.resolveWhileStatement(node);
					break;
			default:
				// console.log(String(node.type).blue);
				return;
			}
		},
		leave: function(node, parent) {
			if (node.type == 'Program' || node.type == 'BlockStatement') {
				if (flags.verbose)
					console.log('leaving scope'.yellow);
			}
		}

	});

};

astFromFile = module.exports.astFromFile = function(file) {
	if (!fs.existsSync(file)) {
		return false;
	}

	var input = fs.readFileSync(file);
	var ast = esprima.parse(input, {loc: true});
	fs.writeFileSync("ASTOutput.json", JSON.stringify(esprima.parse(input, {comment: true}), null, '\t'));
	return ast;
};

// Returns an array from a tree of BinaryExpressions
climb = module.exports.climb =  function(ast) {
	if (ast.type == 'BinaryExpression') {
		return climb(ast.left).concat(climb(ast.right));
	} else {
		return [ast];
	}
};

// Convience function to return the line of a node assuming a node has one. 
function pos(node) {
	return node.loc ? String(node.loc.start.line) : "-1";
}

flags.verbose = process.argv.indexOf('-v') != -1 || true;
console.log(' ---- '.yellow, process.argv[2].white);

var scope = new Scope({sources: sources, file: process.cwd() + '/' + process.argv[2]});

traverse(astFromFile(process.argv[2]), scope);
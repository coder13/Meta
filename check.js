/*
	;(function() {eval(String(require('fs').readFileSync(process.argv[1])));})()
*/

var colors = require('colors'),
	fs = require('fs'),
	path = require('path'),
	esprima = require('esprima'),
	_ = require('underscore'),
	resolve = require('resolve'),
	path = require('path');
	
var sinks = require('./danger.json').sinks;
var sources = require('./danger.json').sources;

var flags = module.exports.flags = {verbose: false, recursive: false};
var lookupTable = {};

var custom = module.exports.custom = [
function(node, scope) { // http.get
	// assertions
	var name = scope.resolveName(node.callee);
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

	if (!flags.recursive)
		return;

	if (node.arguments[0].type == 'Literal') {
		var file = node.arguments[0].value;
		scope.resolvePath(file, function (pkg) {
			if (!pkg)
				return;

			if (lookupTable[pkg])
				return;
			else {
				lookupTable[pkg] = true;

				var ast = astFromFile(pkg);
				if (ast) {
					if (flags.verbose)
						console.log(' ---- '.yellow, pkg);
					var newScope = new Scope({sinks: sinks, sources: sources, file:pkg});
					traverse(ast, newScope);
				} else {
					console.log(' ---- '.yellow, String(pkg).red);
				}
			}
		});
	}

}];

Scope = module.exports.Scope = function(scope) {
	this.vars = scope.vars || {};
	if (!this.vars.module) this.vars.module = {};
	if (!this.vars.global) this.vars.global = {};
	if (!this.vars.process) this.vars.process = {};
	this.sources = scope.sources||sources;
	this.sinks = scope.sinks||sinks;
	this.file = scope.file;
};

// handles creation of variables. 
Scope.prototype.track = function(variable) {
	var scope = this;
	var name = variable.id.name;

	var value = this.resolveExpression(variable.init, function(extra) {
		scope.sources.push(name);
		console.log('[SOURCE]'.red, flags.recursive?String(scope.file + ':' + pos(variable)).grey:pos(variable).grey, name);
	});

	scope.vars[name] = value;

	if (flags.verbose && value)
		console.log('[VAR]'.blue, pos(variable).grey, name, value?value.raw || value:"");
	
};

// returns a value for a variable if one exists
Scope.prototype.resolve = function(name) {
	var scope = this;

	if (scope.vars[name])
		return scope.vars[name];
	try {
		var s = name.indexOf('.') == -1 ? name : name.split('.').slice(0,-1).join('.');
		return scope.vars[s] ? name.replace(s, scope.vars[s].raw||scope.vars[s]) : name;
	} catch (e) {
		return name;
	}
};

Scope.prototype.resolveStatement = function(node) {
	var scope = this;
	switch (node.type) {
		case 'VariableDeclaration':
			node.declarations.forEach(function (i) {
				scope.track(i);
			});
			break;
		case 'CallExpression':
			var ce = scope.resolveCallExpression(node);
			if (!ce.name) {
				return ce;
			}

			var ceName = scope.resolve(ce.name);

			if (flags.verbose)
				console.log('[CE]'.blue, pos(node).grey, ceName, ce.raw);

			if (typeof ceName == 'string') {
				if (this.isSink(ceName)) {
					console.log('[SINK]'.red, flags.recursive?String(scope.file + ':' + pos(node)).grey:pos(node).grey, ceName);
				}
			}

			// if (scope.vars[ce.name]) {
			// 	var func = scope.vars[ce.name];
			// 	var args = _.object(func.params, ce.arguments);
			// }
			return ce;
		case 'AssignmentExpression':
			var assign = scope.resolveAssignment(node);
			var names = assign.names;
			var value = this.resolve(this.resolveExpression(assign.value, function(extra) {
				scope.sources.push(names);
				console.log('[SOURCE]'.red, flags.recursive?String(scope.file + ':' + pos(node)).grey:pos(node).grey, names);
			}));
			// if (node.left.type == 'MemberExpression') {
			//	name = scope.resolveMemberExpression(node.left);
			//	name = eval('scope.vars.' + name);
			// }

			names.forEach(function(name) {
				if (scope.vars[name]) {
					scope.vars[name] = value;
				}
			});

			if (flags.verbose && value)
				console.log('[ASSIGN]'.blue, pos(node).grey, names, value.raw);
			break;
		case 'FunctionDeclaration':
			var func = scope.resolveFunctionExpression(node);
			scope.vars[func.name] = func;

			if (flags.verbose)
				console.log('[FUNC]'.blue, pos(node).grey, func.name);
			break;
		case 'IfStatement':
			scope.traverse(node.consequent);
			break;
		case 'ForInStatement':
		case 'ForStatement':
		case 'WhileStatement':
			this.traverse(node.body, this);
			break;
		case 'TryStatement':
			this.traverse(node.block, this);
			break;
		case 'SwitchStatement':
			if (flags.verbose)
				console.log('[SWITCH]'.blue, pos(node).grey);
				node.cases.forEach(function (i) {
					if (flags.verbose)
						console.log('[CASE]'.blue, pos(node).grey);
					i.consequent.forEach(function (statement) {
						scope.resolveStatement(statement.expression || statement);
					});
				});
			break;
		case 'ReturnStatement':
			if (flags.verbose)
				console.log('[RETURN]'.blue, pos(node).grey, scope.resolveExpression(node.argument));
			break;
	}

};

// Resolves variables and returns a simplifed version. 
Scope.prototype.resolveExpression = function(right, isSourceCB) {
	if (!right){
		return;
	}
	var scope = this;
	switch (right.type) {
		case 'Literal':
			return right.raw;
		case 'Identifier':
			// if variable is being set to a bad variable, mark it too as bad

			var resolved = scope.resolve(right.name);
			if (resolved && typeof resolved == 'String') {
				if (scope.isSource(resolved.name)) {
					if (isSourceCB)
						isSourceCB();
				}
			}
			return scope.resolve(right.name);
		case 'ArrayExpression':
			var array = scope.resolveArrayExpression(right);
			if (flags.verbose)
				console.log('[ARRAY]'.green, pos(right).grey, array);
			return array;
		case 'BinaryExpression':
			climb(right).forEach(function (i) {
				if (i.type == 'Identifier') {
					if (scope.isSource(i.name)) {
						if (isSourceCB)
							isSourceCB(i.name);
					}
				}
			});
			return right;
		case 'CallExpression':
			var ce = scope.resolveCallExpression(right);
			if (!ce.name)
				return ce;
			var ceName = scope.resolve(ce.name).name || scope.resolve(ce.name) || ce.name;

			if (flags.verbose)
				console.log('[CE]'.green, pos(right).grey, ceName, ce.raw);

			if (scope.isSource(ceName || ce.name)) {
				if (isSourceCB)
					isSourceCB(ceName);
			}

			if (this.isSink(ceName)) {
				console.log('[SINK]'.red, flags.recursive?String(scope.file + ':' + pos(right)).grey:pos(right).grey, ceName);
			}

			return ce;
		case 'MemberExpression':
			var me = scope.resolveMemberExpression(right);
			if (typeof me == "string" && scope.isSource(me)) {
				if (isSourceCB)
					isSourceCB();
			}
			return me;
		case 'ObjectExpression': // json objects
			return scope.resolveObjectExpression(right);
		case 'FunctionExpression': // functions
			var fe = scope.resolveFunctionExpression(right);
			this.traverse(fe.body, fe.scope);
			return fe;
	}
};

Scope.prototype.resolveAssignment = function(node) {
	var scope = this;
	if (node.right.type == 'AssignmentExpression') {
		var assign = this.resolveAssignment(node.right);
		return {
			names: assign.names.concat(this.resolveExpression(node.left)),
			value: assign.value
		};
	
	} else {
		return {
			names: [this.resolveExpression(node.left)],
			value: node.right
		};
	}
};

Scope.prototype.resolveArrayExpression = function(node, isSourceCB) {
	var scope = this;
	return _.map(node.elements, function(right) {
		return scope.resolve(scope.resolveExpression(right), isSourceCB);
	});
};

// turns a call expression into a simple json object
Scope.prototype.resolveCallExpression = function(node) {
	if (!node) // node can sometimes be undefined. Find out why later.
		return;
	var scope = this,
		ce = {};
	
	if (node.callee.type == 'FunctionExpression') {
		this.resolveExpression(node.callee);
	} else {
		ce.name = this.resolveName(node.callee);
	}

	if (node.arguments && node.arguments.length > 0){
		_resolveRight = function(right) {
			return scope.resolveExpression(right, function() {});
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
			this.track(v);
		}
	test = this.resolveExpression(node.test);
	if (flags.verbose)
		console.log('[TEST]'.blue, pos(node).grey, test);

	traverse(node.body, this);
	return fs;
};

Scope.prototype.resolveWhileStatement = function(node) {
	var ws = {};
	test = this.resolveExpression(node.test);
	if (flags.verbose)
		console.log('[TEST]'.blue, pos(node).grey);
	
	traverse(node.body, this);
	return ws;
};

Scope.prototype.resolveName = function(name) {
	if (name.type == 'MemberExpression') {
		return this.resolveMemberExpression(name);
	} else {
		return name.name;
	}
};

Scope.prototype.resolveMemberExpression = function(node) {
	var i = this.resolveExpression(node.property);
	b = node.computed ? '[' + i + ']' : '.' + i;
	if (node.object.type == 'MemberExpression') {
		return this.resolveMemberExpression(node.object) + b;
	} else if (node.object.type == 'CallExpression') {
		return this.resolveCallExpression(node.object).raw + b;
	} else if (node.object.type == 'Identifier') {
		return this.resolve(node.object.name)[i] || node.object.name + b;
	} else if (node.object.type == 'Literal') {
		return false;
	}
};

Scope.prototype.resolveObjectExpression = function(node) {
	var scope = this;
	var obj = {};
	node.properties.forEach(function(i) {
		obj[i.key.name] = scope.resolveExpression(i.value);

	});
	return obj;
};

Scope.prototype.resolveFunctionExpression = function(node) {
	var fe = {
		name: node.id ? node.id.name : '',
		params: _.pluck(node.params, 'name'),
		body: node.body
	};

	fe.scope = new Scope(this);
	for (var i in fe.params) {
		fe.scope.addVar(fe.params[i], undefined);
	}

	return fe;
};

// Traverses an array of statments.
Scope.prototype.traverse = function(ast) {
	var scope = this;
	if (ast.type == 'BlockStatement'){
		(ast.body || [ast]).forEach(function (node) {
			if (node.type == 'ExpressionStatement')
				node = node.expression;
			scope.resolveStatement(node);
		});
	} else {
		// ast is a single statement so resolve it instead
		this.resolveStatement(ast.expression || ast);
	}
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

	// try {
		pkg = resolve.sync(file, {basedir: String(this.file).split('/').slice(0,-1).join('/')});
		if (file == pkg)
			return false;
		else if (pkg)
			return cb(pkg);
	// } catch (e) {
	// 	console.error(String(e).red);
	// 	return false;
	// }
};

Scope.prototype.addVar = function(name, value) {
	this.vars[name] = value;
};

Scope.prototype.isSource = function(name) {
	if (typeof name != 'string')
		return false;
	for (var i in this.sources) {
		if (name.search(this.sources[i]) === 0) {
			return true;
		}
	}
	return false;
};

Scope.prototype.isSink = function(name) {
	if (typeof name != 'string')
		return false;
	for (var i in this.sinks) {
		if (name.search(this.sinks[i]) === 0) {
			return true;
		}
	}
	return false;
};

module.exports.Scope = Scope;

traverse = module.exports.traverse = function(ast, scope) {
	if (!ast) {
		console.error('An error occured when parsing the file. The file may not be valid not be valid javascript.');
		return;
	}
	if (flags.verbose) {
		console.log('Creating new scope'.yellow);
		console.log('[SOURCES]'.red, scope.sources);
	}


	ast.body.forEach(function (node) {
		if (node.type == 'ExpressionStatement')
			node = node.expression;
		// console.log(node.type);
		scope.resolveStatement(node);
	});

	if (flags.verbose)
		console.log('leaving scope'.yellow);
};

astFromFile = module.exports.astFromFile = function(file) {
	if (!fs.existsSync(file)) {
		console.error('File does not exist.');
		return false;
	}

	var input = fs.readFileSync(file);
	var ast = esprima.parse(input, {loc: true});
	// fs.writeFileSync("ASTOutput.json", JSON.stringify(esprima.parse(input, {comment: true}), null, '\t'));
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
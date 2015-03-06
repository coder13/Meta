/*
	Terms:
		BE			- Binary Expression
		CE			- Call Expression (functions)
		SCE			- (source) Call Expression
		SCES		- (source) Call Expression Statement
		SASSIGN		- Assign as a sink
*/

var fs = require('fs'),
	path = require('path'),
	colors = require('colors'),
	esprima = require('esprima'),
	_ = require('underscore'),
	resolve = require('resolve'),
	util = require('util');

var custom = module.exports.custom = require('./custom');

var sinks = require('./danger.json').sinks;
var sources = require('./danger.json').sources;

var baseFile;

var cs = {
	'BE': colors.green,
	'CE': colors.green,
	'SCE': colors.red,
	'SCES': colors.red,
	'SINK': colors.red,
	'SASSIGN': colors.red,
	'SOURCE': colors.red,
	'SOURCES': colors.yellow,
	'RETURN': colors.red
};

Scope = function(scope) {
	this.vars = scope.vars || {};
	if (!this.vars.module) this.vars.module = {exports: {}};
	if (!this.vars.global) this.vars.global = {};
	this.sources = scope.sources||sources;
	this.sinks = scope.sinks||sinks;
	this.log = Scope.log;
	this.file = scope.file;
	if (!baseFile) baseFile = scope.file;
	this.reports = scope.reports || [{source: {name: 'process.argv'}}];
};

Scope.log = function(type, node, name, value) {};

// handles creation of variables. 
Scope.prototype.track = function(variable) {
	var scope = this;
	var name = variable.id.name;

	var expr = this.resolveExpression(variable.init, function(value) {
		if (value) {
			var resolved = scope.resolve(value);
			if (resolved && typeof resolved == 'string') {
				if (scope.isSource(resolved.name || resolved) || scope.isSource(value.name || value)) {
					scope.sources.push(name);
					scope.log('SOURCE', variable, name, value);
				}
			}
		}

	});
	
	this.vars[name] = expr;

	this.log('VAR', variable, name);
};

// returns a value for a variable if one exists
Scope.prototype.resolve = function(name) {
	if (!name || typeof name != 'string')
		return false;

	if (get(this.vars, name)) {
		return eval('this.vars.' + name);
	}
	else if (name.indexOf('.') != -1) {
		var s = name.split('.');
		var r = this.resolve(s.slice(0,-1).join('.'));
		r = r.raw || r;
		return r + '.' + s.slice(-1);
	
	}

	return name;
};

function get(json, name) {
	if (name.indexOf('.') == -1)
		return json[name];
	else {
		var s = name.split('.');
		try {
			return get(json[s[0]], s.slice(1).join('.'));
		} catch(e) {
			return false;
		}
	}
}

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

			var t = 'CES';

			if (ce.arguments)
				ce.arguments.some(function (arg) {
					if (!arg || (arg.scope && arg.params && arg.body))
						return false;
					var resolved = scope.resolve(arg);
					var source = resolved;
					if (scope.isSource(arg.name || arg) || scope.isSource(resolved.name || resolved) ||
						(traverseJSON(arg, function (a) {
							if (!a) return false;
							var r = scope.resolve(a);
							if (scope.isSource(a.name || a) || scope.isSource(r.name || r)) {
								source = r;
								return true;
							}
							return false;
						}))) {

						// If the function is a sink and there is a source, return as sink;
						// If not a sink but still has source, return as a Source CES (possible taint)
						t = (scope.isSink(ce.name) || scope.isSink(ceName))?'SINK':'SCES';
						scope.log(t, node, ce.name, source.name || source);
						return true;
					}
					return false;
				});

			if (typeof ceName == 'string')
				this.log(t, node, ce.name, typeof ceName == 'string'?ceName:{});

			return ce;
		case 'AssignmentExpression':
			var assign = scope.resolveAssignment(node);
			var names = assign.names;
			var value = this.resolveExpression(assign.value, function(value, isSource) {
				if (value) {
					var resolved = scope.resolve(value);
					if (resolved && typeof resolved == 'string') {
						if (node.right.type == 'Identifier' &&
							(scope.isSink(value.name || value) || scope.isSink(resolved.name || resolved))) {
							scope.sinks.push(names);
							scope.log('SASSIGN', node, names.length==1?names[0]:names, value);
						} else if (scope.isSource(resolved.name || resolved) || scope.isSource(value.name || value)) {
							scope.sources.push(names);
							scope.log('SOURCE', node, names.length==1?names[0]:names, value);
						}
					}
				}
			});

			names.forEach(function(name) {
				try {
					if (node.left.type == 'MemberExpression') {
						eval('scope.vars.' + name + ' = ' + JSON.stringify(value));
					}
				} catch (e) {
				
				}
			});

			if (value)
				this.log('ASSIGN', node, names.length==1?names[0]:names, util.inspect(value.raw || value, {depth: 1}));
			break;
		case 'FunctionDeclaration':
			var func = scope.resolveFunctionExpression(node);
			scope.vars[func.name] = func;

			traverse(func.body, func.scope);

			this.log('FUNC', node, func.name);
			break;
		case 'IfStatement':
			this.resolveExpression(node.test);
			scope.traverse(node.consequent);
			if (node.alternate)
				scope.traverse(node.alternate);
			break;
		case 'ForInStatement': // These
		case 'ForStatement':   // are
		case 'WhileStatement': // all
		case 'CatchClause':    // the same
			this.traverse(node.body);
			break;
		case 'TryStatement': // cept this
			this.traverse(node.block);
			node.handlers.forEach(function (h) {
				scope.resolveStatement(h);
			});
			break;
		case 'SwitchStatement':
			this.log('SWITCH', node);
			node.cases.forEach(function (i) {
				scope.log('CASE', node);
				i.consequent.forEach(function (statement) {
					scope.resolveStatement(statement.expression || statement);
				});
			});
			break;
		case 'ReturnStatement':
			if (node.argument)
				scope.resolveExpression(node.argument);
			break;
	}

};

// Resolves variables and returns a simplifed version. 
Scope.prototype.resolveExpression = function(right, isSourceCB) {
	if (!right) {
		return;
	}
	var scope = this;
	switch (right.type) {
		case 'Literal': // string, number, etc..
			return right.raw;
		case 'Identifier': // variables, etc...
			// if variable is being set to a bad variable, mark it too as bad
			if (isSourceCB) {
				isSourceCB(right.name);
			}
			return right.name;
		case 'ThisExpression':
			return {};
		case 'UpdateExpression':
		case 'UnaryExpression':
			var arg = this.resolveExpression(right.argument, isSourceCB);
			// console.log(right.operator, arg);
			return {};
		case 'ArrayExpression':
			var array = scope.resolveArrayExpression(right);
			this.log('ARRAY', right, array);
			return array;
		case 'ConditionalExpression':
		case 'LogicalExpression':
		case 'BinaryExpression': // A + B - C * D
			var bin = {
				left: this.resolveExpression(right.left, isSourceCB),
				op: right.operator,
				right: this.resolveExpression(right.right, isSourceCB)
			};

			return bin;
		case 'NewExpression':  // New
		case 'CallExpression': //     foo()
			var ce = scope.resolveCallExpression(right);
			
			if (!ce.name || typeof ce.name != 'string')
				return ce;

			var ceName = scope.resolve(ce.name);

			var t = 'CE';
			if (ceName && typeof ceName == 'string') {
				if (ce.arguments) {
					ce.arguments.some(function (arg) {
					if (!arg || (arg.scope && arg.params && arg.body))
						return false;
						var resolved = scope.resolve(arg);
						var source = resolved;

						if (scope.isSource(arg.name || arg) || scope.isSource(resolved.name || resolved) ||
							(traverseJSON(arg, function (a) {
								if (!a) return false;
								var r = scope.resolve(a);
								if (scope.isSource(a.name || a) || scope.isSource(r.name || r)) {
									source = r;
									return true;
								}
								return false;
							}))) {
							
							
							// If the function is a sink and there is a source, return as sink;
							// If not a sink but still has source, return as a Source CES (possible taint)
							t = (scope.isSink(ce.name) || scope.isSink(ceName))?'SINK':'SCES';
							scope.log(t, right, ce.name, source);
						}
						return false;
					});
				}

				if (isSourceCB)
					isSourceCB(ceName, t == 'SCE');
			}

			this.log(t, right, ce.raw, typeof ceName == 'string'?ceName:{});

			return ce;
		case 'MemberExpression': // a.b.c.d
			var me = scope.resolveMemberExpression(right);
			if (isSourceCB)
				isSourceCB(me);
			
			return me;
		case 'ObjectExpression': // json objects
			return scope.resolveObjectExpression(right);
		case 'FunctionExpression': // functions
			var fe = scope.resolveFunctionExpression(right);
			return fe;
		case 'AssignmentExpression':
			var assign = scope.resolveAssignment(right);
			var names = assign.names;
			var value = this.resolveExpression(assign.value, function(value, isSource) {
				if (value) {
					var resolved = scope.resolve(value);
					if (resolved && typeof resolved == 'string') {
						if (scope.isSink(value.name || value) || scope.isSink(resolved.name || resolved)) {
							scope.sinks.push(names);
							scope.log('SASSIGN', right, names.length==1?names[0]:names, value);
						} else if (scope.isSource(resolved.name || resolved) || scope.isSource(value.name || value)) {
							scope.sources.push(names);
							scope.log('SOURCE', right, names.length==1?names[0]:names, value);
						}
					}
				}
			});

			names.forEach(function(name) {
				try {
					if (right.left.type == 'MemberExpression') {
						if (scope.vars[name] || scope.vars[name.split('.').slice(-1).join('.')])
							eval('scope.vars.' + name + ' = ' + JSON.stringify(value));
						else
							eval('scope.vars.' + name + ' = ' + JSON.stringify(value));
					}
				} catch (e) {
				
				}
			});

			if (value)
				this.log('ASSIGN', right, names.length==1?names[0]:names, util.inspect(value.raw || value, {depth: 1}));
			break;
		// default:
		// 	console.log(right.type, this.file + ':' + pos(right));
		// 	return {};
	}
	return {};
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
	return _.map(node.elements, function(expr) {
		return scope.resolve(scope.resolveExpression(expr), isSourceCB);
	});
};

Scope.prototype.resolveCallExpression = function(node) {
	if (!node) // node can sometimes be undefined. Find out why later.
		return;
	var scope = this, ce = {};
	
	if (node.callee.type == 'FunctionExpression') {
		this.resolveExpression(node.callee);
	} else {
		ce.name = this.resolveName(node.callee);
	}

	if (node.arguments && node.arguments.length > 0){
		_resolveRight = function(expr) {
			return scope.resolveExpression(expr, function() {});
		};
		ce.arguments = _.map(node.arguments, _resolveRight);
	}
	ce.raw = ce.name + '(' + (ce.arguments ? ce.arguments.join(','):'') + ')';

	custom.some(function(i) {
		var r = false;
		if (ce.name) {
			r = i(scope, node, ce); // result
			if (r)
				ce = r;
		}
		return !!r;
	});
	return ce;
};

Scope.prototype.resolveName = function(name) {
	if (name.type == 'MemberExpression') {
		return this.resolveMemberExpression(name);
	} else {
		return name.name;
	}
};

Scope.prototype.resolveMemberExpression = function(node) {
	var obj = this.resolveExpression(node.object);
	obj = obj.raw || obj.name || obj;
	var p = this.resolveExpression(node.property);
	p = p.raw || p.name || p;
	
	return obj + (node.computed ? '[' + p + ']' : '.' + p);
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
	var scope = this;
	var fe = {
		name: node.id ? node.id.name : '',
		params: _.pluck(node.params, 'name'),
		body: node.body
	};

	fe.scope = new Scope(this);
	for (var i in fe.params) {
		fe.scope.addVar(fe.params[i], undefined);
	}
	fe.scope.traverse(fe.body, function(node) {
		// Push scope.log. We don't want line 466 to log anything. Then pop it.
		var l = scope.log; scope.log = function () {};
		var arg = scope.resolveExpression(node.argument);
		scope.log = l;

		var resolved = scope.resolve(arg);
		if (resolved && typeof resolved == 'string') {
			if (scope.isSource(resolved.name || resolved) || scope.isSource(arg.name || arg)) {
				if (fe.name)
					scope.sources.push(fe.name);
				scope.log('RETURN', node, fe.name, arg, resolved);
			}
		}
	});

	return fe;
};

// Traverses an array of statments.
Scope.prototype.traverse = function(ast, returnCB) {
	var scope = this;
	
	if (Scope.createNewScope)
		Scope.createNewScope();
	scope.log('SOURCES', ast, scope.sources);

	if (ast.type == 'BlockStatement'){
		(ast.body || [ast]).forEach(function (node) {
			if (node.type == 'ExpressionStatement')
				node = node.expression;
			scope.resolveStatement(node);
			if (returnCB && node.type == 'ReturnStatement') {
				returnCB(node);
			}
		});
	} else {
		// ast is a single statement so resolve it instead
		this.resolveStatement(ast.expression || ast);
	}

	if (Scope.leaveScope)
		Scope.leaveScope();
};

Scope.prototype.resolvePath = function(file, cb) {
	var pkg;
	if (file.indexOf('./') === 0 || file.indexOf('../') === 0) {
		if (path.extname(file) == '.json') {
			return false;
		}
	}

	try {
		pkg = resolve.sync(file, {basedir: String(this.file).split('/').slice(0,-1).join('/')});
	} catch (e) {
		console.error(String(e));
		return false;
	}

	if (file == pkg)
		return false;
	else if (pkg)
		return cb(pkg);
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


// Returns an array from a tree of BinaryExpressions
// traverseJSON will also work but will report the operators too.
climb = function(ast) {
	if (ast.type == 'BinaryExpression') {
		return climb(ast.left).concat(climb(ast.right));
	} else {
		return [ast];
	}
};

// Traverses a json object and runs the callback on any non-object.
traverseJSON = function(o,func) {
	return typeof o == 'object'? _.some(o, function(i) {
		if (!i)
			return false;
		if (typeof i == 'object') {
			if (!i || (i.scope && i.params && i.body))
				return false;
			return traverseJSON(i, func);
		} else {
			return func(i);
		}

		return false;
	}) : false;
};
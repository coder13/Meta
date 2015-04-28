/*
	Terms:
		BE			- Binary Expression
		CE			- Call Expression (functions)
		SCE			- (source) Call Expression
		SCES		- (source) Call Expression Statement
		SINK		- Assign as a sink
*/

var fs = require('fs'),
	path = require('path'),
	colors = require('colors'),
	esprima = require('esprima'),
	_ = require('underscore'),
	resolve = require('resolve'),
	util = require('util');

// Global initial list of sources and sinks
var Sinks = require('./danger.json').sinks;
var Sources = require('./danger.json').sources;

var lookupTable = {};

module.exports.flags = flags = {
	verbose: false,
	recursive: false,
	json: true,
	debug: false
};

var custom = module.exports.custom = [
function(scope, node, ce) { // http.get
	var ceName = scope.resolve(ce.name);
	if (ceName != "require('http').get") {
		return false;
	}
	
	var func = ce.arguments[1];
	scope.sources[func.params[1]] = func.params[1];
	Scope.log.call(func.scope, 'SOURCE', node, false, func.params[1]);
	traverse(func.body, func.scope, returnCB(func));
	return true;
}, function (scope, node, ce) {
	var ceName = scope.resolve(ce.name);
	if (ceName != "require('http').createServer") {
		return false;
	}

	var func = ce.arguments[0];
	func.scope.sources[func.params[0]] = func.params[0];
	Scope.log.call(func.scope, 'SOURCE', node, false, func.params[0]);
	traverse(func.body, func.scope, returnCB(func));
	return true;
}, function(scope, node, ce) {// (new require('hapi').server()).route()
	if (ce.name.indexOf("require('hapi').Server()") === 0)
		return false;
	var ceName = scope.resolve(ce.name);
	if (typeof ceName != "string" || ceName.split('.').slice(-1)[0] != "route")
		return false;

	if (ce.arguments[0]) {
		var func;
		if (ce.arguments[0].config && ce.arguments[0].config.handler) {
			func = ce.arguments[0].config.handler;
		} else {
			func = ce.arguments[0].handler;
		}

		if (func && func.scope) {
			func.scope.sources[func.params[0]] = func.params[0];
			Scope.log.call('SOURCE', node, false, func.params[0]);
			traverse(func.body, func.scope, returnCB(func));
		}
	}

	return true;

}, function(scope, node, ce) {// (new require('express').Router()).route() && .post()
	var ceName = scope.resolve(ce.name);
	if (typeof ceName != "string" || ceName.indexOf('express') == -1)
		return false;
	if (['post', 'get'].indexOf(ceName.split('.').slice(-1)[0]) == -1)
		return false;


	if (ce.arguments && ce.arguments[1]) {
		var func = ce.arguments[1];
		if (func && func.scope) {

			func.scope.sources[func.params[0]] = func.params[0];
			Scope.log.call(func.scope, 'SOURCE', node, false, func.params[0]);
			traverse(func.body, func.scope, returnCB(func));

		}
	}

	return true;

}, function(scope, node, ce) {// require('fs').readFile
	var ceName = scope.resolve(ce.name);
	if (ceName != "require(\'fs\').readFile") {
		return false;
	}
	
	var func = ce.arguments[1]; // the callback
	if (func && func.scope) {
		func.scope.sources[func.params[1]] = func.params[1]; // the 2nd argument is the source
		Scope.log.call(func.scope, 'SOURCE', node, false, func.params[1]);

		traverse(func.body, func.scope, returnCB(func));
	}
	return true;
}];

var returnCB = function (fe, node) {
	var scope = this;
	return function(node) {
		// Push scope.log. We don't want line 466 to log anything. Then pop it.
		var l = Scope.log; Scope.log = function () {};
		var arg = scope.resolveExpression(node.argument);
		Scope.log = l;

		var source = scope.resolveTree(scope.isSource, arg);
		if (source) {
			scope.source[fe.name] = fe.name;
			Scope.log.call(scope, 'RETURN', node, fe.names)
		}

	};
};


function Scope (scope) {
	this.vars = scope.vars || {};
	if (!this.vars.module) this.vars.module = {exports: {}};
	if (!this.vars.exports) this.vars.exports = {};
	if (!this.vars.global) this.vars.global = {};

	// dynamic list of sources and sinks as variables get set to them
	this.sources = scope.sources || JSON.parse(JSON.stringify(Sources)); // clever clone
	this.sinks = scope.sinks || Sinks.slice(0); // another clever clone but for arrays

	this.file = scope.file;

	if (!Scope.baseFile)
		Scope.baseFile = scope.file;
	
	file = path.relative(Scope.baseFile.split('/').reverse().slice(1).reverse().join('/'), this.file);
	this.reports = scope.reports || [{source: {name: 'process.argv', line: file + ':0'}}];
}

Scope.log = function(type, node, name, value) {};

// handles creation of variables. 
Scope.prototype.track = function(variable) {
	var scope = this;
	var name = variable.id.name;

	var type = 'VAR';
	var expr = this.resolveExpression(variable.init, name, function(value, reason) {
		// determines whether value is a sink or a source and handles it
		if (!value) {
			console.log('value was undefined for some reason');
			throw new Exception('value was undefined');
		}

		if (!reason)
			reason = scope.resolve(value);

		var danger;
		if (variable.type == 'Identifier') {
			danger = scope.resolveTree(scope.isSink, value);
			if (danger) {
				scope.sinks.push(name);
				type = 'SINK_ASSIGN';
			}
		} else {
			danger = scope.resolveTree(scope.isSource, value);
			if (danger) {
				scope.sources[name] = reason;
				type = 'SOURCE';
			}
		}
	});
	
	this.vars[name] = expr;

	Scope.log.call(this, type, variable, name, expr ? (expr.raw || expr.name || expr) : undefined);
};


// returns a value for a variable if one exists
// if a = b
// resolve(a) will result in b
Scope.prototype.resolve = function(name) {
	if (!name || typeof name != 'string')
		return false;

	if (get(this.vars, name)) {
		return eval('this.vars.' + name);
	} else if (name.indexOf('.') != -1) {
		var s = name.split('.');
		var r = this.resolve(s.slice(0,-1).join('.'));
		r = r.raw || r;
		return r + '.' + s.slice(-1);
	} else if (name.indexOf('[') != -1 && name.indexOf(']') != -1) {
		return eval('this.vars.' + name);
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
			if (!ce.name)
				break;

			var ceName = scope.resolve(ce.name);

			var t = 'CES'; // Call Expression Statement (I.E. a function)

			if (ce.arguments) {
				// for all arguments, check if it is a source
				ce.arguments.some(function (arg) {
					if (arg.params && arg.body && arg.scope)
						return false; // skips callbacks

					debugger;
					var source = scope.resolveTree(scope.isSource, arg);
					if (source) {

						// If the function is a sink and there is a source, return as sink;
						// If not a sink but still has source, return as a Source CSCESES (possible taint)
						t = (scope.isSink(ce.name) || scope.isSink(ceName))?'SINK':'SCES';
						Scope.log.call(scope, t, node, ce.name, scope.sources[source]);
						return true;
					}
					return false;
				});
			}

			if (typeof ceName == 'string' && flags.verbose)
				Scope.log.call(this, t, node, ce.raw);

			break;
		case 'AssignmentExpression':
			var assign = scope.resolveAssignment(node);
			var names = assign.names;
			var type = 'ASSIGN';
			var value = this.resolveExpression(assign.value, names, function(value) {
				if (!value) {
					console.log('value was undefined for some reason');
					throw new Exception('value was undefined');
				}

				var danger = scope.resolveTree(scope.isSink, value);
				if (danger) {
					names.forEach(function (name) {
						scope.sinks.push(name);
					});
					type = 'SINK_ASSIGN'
				} else {
					danger = scope.resolveTree(scope.isSource, value);
					if (danger) {
						names.forEach(function (name) {
							scope.sources[name] = scope.resolve(value);
						});
						type = 'SOURCE_ASSIGN';
					}
				} 
					
				
			});

			names.forEach(function(name) {
				try {
					if (node.left.type == 'MemberExpression') {
						v = typeof value == "object" ? JSON.stringify(value) : String(value);
						eval('scope.vars.' + name + ' = "' + v + '"');
					}
				} catch (e) {}
			});

			if (value) {
				names.forEach(function (name) {
					Scope.log.call(scope, type, node, name, value);
				});
			}
			
			break;
		case 'FunctionDeclaration':			
			if (Scope.createNewScope)
				Scope.createNewScope();

			var func = scope.resolveFunctionExpression(node, this);

			Scope.log.call(this, 'SOURCES', node, scope.sources.keys);

			Scope.log.call(this, 'FUNC', node, func.name);
			
			if (Scope.leaveScope())
				Scope.leaveScope();

			break;
		case 'IfStatement':
			this.resolveExpression(node.test);
			scope.traverse(node.consequent);
			if (node.alternate)
				scope.traverse(node.alternate);
			break;
		case 'ForInStatement': // These
		case 'ForStatement':   // are
			if (node.init || node.left)
				this.resolveStatement(node.init || node.left);
		case 'WhileStatement': // all
			if (node.test)
				this.resolveExpression(node.test);
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
			Scope.log.call(this, 'SWITCH', node);
			node.cases.forEach(function (i) {
				Scope.log.call(scope, 'CASE', node);
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
Scope.prototype.resolveExpression = function(right, name, isSourceCB) {
	if (!right) {
		return;
	}
	var scope = this;
	switch (right.type) {
		case 'Literal': // string, number, etc..
			return typeof right.value == 'string' ?
				"'" + right.value + "'" : right.value;
			// return "'" + eval(right.raw) + "'";
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
			var arg = this.resolveExpression(right.argument, isSourceCB, name);
			return {};
		case 'ArrayExpression':
			var array = scope.resolveArrayExpression(right, name);
			Scope.log.call(scope, 'ARRAY', right, array);
			return array;
		case 'ConditionalExpression':
		case 'LogicalExpression':
		case 'BinaryExpression': // A + B - C * D
			var bin = {
				left: this.resolveExpression(right.left, isSourceCB, name),
				op: right.operator,
				right: this.resolveExpression(right.right, isSourceCB, name)
			};

			return bin;
		case 'NewExpression':  // New
		case 'CallExpression': //     foo()
			var ce = scope.resolveCallExpression(right);
			
			if (!ce.name || typeof ce.name != 'string')
				return ce;

			var ceName = scope.resolve(ce.name);
			if (flags.recursive && ceName === 'require') {
				scope.resolveRequire(right, ce, {
					   'sink': function (value) {
						scope.sinks.push(value.replace('module.exports', name))
					}, 'source': function (value, reason) {
						scope.sources[value.replace('module.exports', name)] = reason;
					}, 'report': function (report) {

					}
				});
			}

			var t = 'CE';
			if (ceName && typeof ceName == 'string') {
				if (ce.arguments) {
					ce.arguments.some(function (arg) {
						if (!arg)
							return;
						if (arg.params && arg.body && arg.scope)
							return false; // skips callbacks
						var source = scope.resolveTree(scope.isSource, arg);
						if (source) { // I do want to set source to resolveTree(scope.isSource, arg)
							// If the function is a sink and there is a source, return as sink;
							// If not a sink but still has source, return as a Source CES (possible taint)

							t = (scope.isSink(ce.name) || scope.isSink(ceName))?'SINK':'SCES';

							Scope.log.call(scope, t, right, ce.name, scope.sources[source]);
						}
					});
				}

				if (isSourceCB)
					isSourceCB(ceName, t == 'SCE');
			}

			if (typeof ceName == 'string' && flags.verbose)
				Scope.log.call(this, t, right, ce.raw);

			return ce;
		case 'MemberExpression': // a.b.c.d
			var me = scope.resolveMemberExpression(right);
			if (isSourceCB)
				isSourceCB(me);
			
			return me;
		case 'ObjectExpression': // json objects
			return scope.resolveObjectExpression(right);
		case 'FunctionExpression': // functions
			if (Scope.createNewScope)
				Scope.createNewScope();

			var fe = scope.resolveFunctionExpression(right, this);
			
			if (Scope.leaveScope())
				Scope.leaveScope();

			return fe;
		case 'AssignmentExpression': // a = b
			var assign = scope.resolveAssignment(right);
			var names = assign.names;
			var type = 'ASSIGN';
			var value = this.resolveExpression(assign.value, names, function(value) {
				if (!value) {
					console.log('value was undefined for some reason');
					throw new Exception('value was undefined');
				}

				var danger;
				if (assign.value.type == 'Identifier') {
					danger = scope.resolveTree(scope.isSink, value);
					if (danger) {
						names.forEach(function (name) {
							scope.sinks.push(name);
						});
						type = 'SINK_ASSIGN'
					}
				} else {
					danger = scope.resolveTree(scope.isSource, value);
					if (danger) {
						names.forEach(function (name) {
							scope.sources[name] = name;
						});
						type = 'SOURCE_ASSIGN';
					}
				}
			});

			names.forEach(function(name) {
				try {
					if (node.left.type == 'MemberExpression') {
						v = typeof value == "object" ? JSON.stringify(value) : String(value);
						eval('scope.vars.' + name + ' = "' + v + '"');
					}
				} catch (e) {
					
				}
			});

			if (value)
				Scope.log.call(this, type, right, names.length==1?names[0]:names, util.inspect(value.raw || value, {depth: 1}));
			
			return value;
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

Scope.prototype.resolveArrayExpression = function(node, name, isSourceCB) {
	var scope = this;
	return _.map(node.elements, function(expr, index) {
		return scope.resolve(scope.resolveExpression(expr, name, function (right) {
			danger = scope.resolveTree(scope.isSink, right);
			if (danger) {
				scope.sinks.push(name + '[' + index + ']');
				Scope.log.call(scope, 'SINK', node, name + '[' + index + ']');
			} else {
				danger = scope.resolveTree(scope.isSource, right);
				if (danger) {
					scope.sources[name + '[' + index + ']'] = scope.resolve(right);
					Scope.log.call(scope, 'SOURCE', node, name + '[' + index + ']', scope.resolve(right));
				}
			}
			// console.log(scope.sinks, scope.sources);
		}));
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
			return scope.resolveExpression(expr, function() {

			});
		};
		ce.arguments = _.map(node.arguments, _resolveRight);
	}
	ce.raw = ce.name + '(' + (ce.arguments ? ce.arguments.join(','):'') + ')';

	if (ce.name) {
		var r = false;
		custom.some(function(i) {
			if (r = i(scope, node, ce))
				ce = r;
			return !!r;
		});
	}
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

Scope.prototype.resolveFunctionExpression = function(node, parent) {
	var scope = this;
	var fe = {
		name: node.id ? node.id.name : '',
		params: _.pluck(node.params, 'name'),
		body: node.body
	};

	fe.scope = new Scope(scope);
	for (var i in fe.params) {
		fe.scope.addVar(fe.params[i], undefined);
	}

	if (fe.name != '') { // Catches defining nameless functions as callbacks
		scope.vars[fe.name] = fe;

		fe.scope.traverse(fe.body, function(node) {
			// Push Scope.log. We don't want line 466 to log anything. Then pop it.
			var l = Scope.log; Scope.log = function () {};
			var arg = scope.resolveExpression(node.argument);
			Scope.log = l;

			if (fe.name) {
				var source = scope.resolveTree(scope.isSource, arg);
				if (source) {
			
					scope.sources[fe.name] = source;
					Scope.log.call(scope, 'RETURN', node, fe.name, arg);
				}
			}
		});
	} // we don't want to traverse callback functions just yet because that's handled later;
	return fe;
};

// complicated code to check if the argument is a source 
// and returns the part of it that is the source
Scope.prototype.resolveTree = function(func, expr) {
	var scope = this;
	
	// specifically handles call expressions
	if (expr.name && expr.arguments && expr.raw) {
		var danger = false;
		expr.arguments.some(function (i) {
			danger = scope.resolveTree(func, i);
			return !!danger;
		});
		return danger;
	} else if (expr.body && expr.params && expr.scope) {
		return false;
	}

	var resolved = this.resolve(expr);

	if (typeof expr == 'object' || typeof resolved == 'object') {
		var danger;
		(traverseJSON(expr, function (a) {
			if (!a) return false;
			danger = scope.resolveTree(func, a);
			return danger;
		}));
		return danger;
	} else {
		if (func.call(scope, expr.name || expr)) 
			return expr;
		else if (func.call(scope, resolved.name || resolved))
			return resolved;
	}

	return false;
};

// Traverses an array of statments.
Scope.prototype.traverse = function(ast, returnCB) {
	var scope = this;
	
	if (ast.type == 'BlockStatement'){
		(ast.body || [ast]).forEach(function (node) {
			if (node.type == 'ExpressionStatement')
				node = node.expression;
			try {
				scope.resolveStatement(node);
				if (returnCB)
					if (returnCB && node.type == 'ReturnStatement') {
						returnCB.call(this, node);
					}
			} catch (e) {
				if (flags.debug) {
					console.error('Error reading line:'.red, scope.file + ':' + pos(node));
					console.error(e.stack);
				}
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
		return false;
	}

	if (file == pkg)
		return false;
	else if (pkg)
		return cb(pkg);
};

Scope.prototype.resolveRequire = function(node, ce, handleBad) { // require
	if (ce.name != 'require')
		return false;

	if (!ce.arguments[0])
		return;

	var file;
	if (node.arguments[0].type == 'Literal') {
		file = node.arguments[0].value;
	} else if (node.arguments[0].type == 'Identifier') {
		file = this.resolve(node.arguments[0].name);
		if (typeof file != 'string')
			return;
	} else {
		return;
	}

	if (['hapi', 'express', 'jade', 'mysql', 'consolidate'].indexOf(file) != -1 || file.indexOf('hapi') != -1)
		return; // just ignore these things. They have prewritten handlers anyways.

	var scope = this;
	var r;
	this.resolvePath(file, function (pkg) {
		if (!pkg)
			return;

		// Lookup table is a list of files already looked at.
		// In static analysis, we only want to look at each file once.
		if (lookupTable[pkg])
			return;
		lookupTable[pkg] = true;

		var ast = astFromFile(pkg);
		if (ast) {
			if (flags.verbose && !flags.json)
				console.log(' ---- '.yellow, pkg);

			var newScope = new Scope({
				file: pkg,
			});
			traverse(ast, newScope);

			r = newScope.vars.module.exports;
			
			newScope.sinks.forEach(function (i) {
				if (i.indexOf('module.exports.') === 0)
					handleBad['sink'](i)
					// scope.sinks.push(i.replace('module.exports', 'a'))
			});

			for (var i in newScope.sources) {
				if (i.indexOf('module.exports.') === 0)
					handleBad['source'](i, newScope.sources[i]);
					// scope.sources[i.replace('module.exports', 'a')] = newScope.sources[i];
			}

			if (flags.json) {
				newScope.reports.forEach(function (report) {
					bad = false;
					if (report.chain) {
						report.chain.forEach(function (c) {
							if (newScope.isSource(c.value)) {
								bad = true;
								return;
							}
						})
					}

					if (bad) {
						scope.reports.push(report);
					}
				});
			}

		} else
			if (flags.verbose && !flags.json)
				console.log(' ---- '.yellow, String(pkg).red);
	});

	return r;
};

Scope.prototype.addVar = function(name, value) {
	this.vars[name] = value;
};

Scope.prototype.isSource = function(name) {
	if (typeof name != 'string')
		return false;
	for (var i in this.sources) {
		if (typeof this.sources[i] != 'string')
			return false;
		if (name.indexOf(i + '.') === 0 ||
			name.indexOf(i + '(') === 0 ||
			name.indexOf(i + '[') === 0 ||
			name == i) {
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

// Convience function to return the line of a node assuming a node has one. 
pos = module.exports.pos = function(node) {
	return node.loc ? String(node.loc.start.line) : "-1";
};
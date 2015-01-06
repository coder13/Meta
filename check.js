/*
	;(function() {eval(String(require('fs').readFileSync(process.argv[1])));})()
*/

var colors = require('colors'),
	fs = require('fs'),
	path = require('path'),
	esprima = require('esprima'),
	estraverse = require('estraverse'),
	_ = require('underscore'),
	flags = {verbose: false};

var custom = [function(node, scope) { // http.get
	// assertions
	if (node.type != 'CallExpression')
		return;

	var name = scope.resolveName(node.callee); // We only want to get the name;
	if (name != 'require(\'http\').get') {
		return;
	}
	
	var ce = scope.resolveCallExpression(node);
	var func = ce.arguments[1];

	func.scope.sources = func.scope.sources.concat(func.params[0]);
	traverse(func.body, func.scope);

}];

sinks = module.exports.sinks = require('./danger.json').sinks;
sources = module.exports.sources = require('./danger.json').sources;

var self;

Scope = function(scope) {
	if (flags.verbose)
		console.log('creating new scope'.yellow);
	this.vars = scope.vars||[];
	this.sources = scope.sources||[];
	self = this;
};

// handles creation of variables. 
Scope.prototype.track = function(variable) {
	// console.log(variable);
	var name = variable.id.name;

	var value = self.resolveRight(variable.init, function() {
		self.sources.push(name);
		console.log('[SOURCE]'.red, pos(variable).grey, name);
	});

	self.vars[name] = value;

	if (flags.verbose)
		console.log('[VAR]'.blue, pos(variable).grey, name, value);
	
};

// returns a value for a variable if one exists
Scope.prototype.resolve = function(name) {
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
			if (self.isVariableASource(self.resolve(right.name))) {
				if (isSourceCB)
					isSourceCB();
			}
			return self.resolve(right.name);
		case 'ArrayExpression':
			var array = self.resolveArrayExpression(right);
			return array;
		case 'BinaryExpression':
			climb(right).forEach(function (i) {
				if (i.type == 'Identifier') {
					if (self.isVariableASource(i.name)) {
						if (isSourceCB)
							isSourceCB();
					}
				}
			});
			break;
		case 'CallExpression':
			var ce = self.resolveCallExpression(right);
			var ceName = self.resolve(ce.name);
			if (flags.verbose)
				console.log('[CE]'.green, pos(right).grey, ceName, ce.raw);

			if (isSink(ceName)) {
				console.log('[SINK]'.red, pos(right).grey, ceName);
			}

			return ce;
		case 'MemberExpression':
			var me = self.resolveMemberExpression(right);
			if (self.isVariableASource(me)) {
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

Scope.prototype.resolveArrayExpression = function(node) {
	return _.map(node.elements, self.resolveRight);
};

// turns a call expression into a simple json object
Scope.prototype.resolveCallExpression = function(node) {
	if (!node) // node can sometimes be undefined. Find out why later.
		return;
	var ce = {};
	if (node && node.type == 'CallExpression') {
		ce.name = self.resolveName(node.callee);
	}

	if (node.arguments.length > 0){
		_resolveRight = function(right) {
			return self.resolveRight(right, function() {});
		};
		ce.arguments = _.map(node.arguments, _resolveRight);
	}
	ce.raw = ce.name +
		"(" + (ce.arguments ? ce.arguments.join(",") : "") + ")";

	return ce;
};

Scope.prototype.resolveForStatement = function(node) {
	var fs = {};
	var fsScope = new Scope(self);
	for (var i = 0; i < node.init.declarations.length; i++) {
		var v = node.init.declarations[i];
		fsScope.track(v);
	}
	test = (function(test) {
		var t= {left: self.resolveName(test.left),
				operator: test.operator,
				right: self.resolveRight(test.right)};
		t.raw = String(t.left) + " " + t.operator + " " + t.right;
		return t;
	})(node.test);
	if (flags.verbose)
		console.log('[TEST]'.blue, pos(node).grey, test.raw);

	traverse(node.body, fsScope);
	return fs;
};

Scope.prototype.resolveWhileStatement = function(node) {
	var ws = {};


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
	var b = self.resolveRight(node.property);
	b = node.computed ? '[' + b + ']' : '.' + b;
	if (node.object.type == 'MemberExpression') {
		return self.resolveMemberExpression(node.object) + b;
	} else if (node.object.type == 'CallExpression') {
		return self.resolveCallExpression(node.object).raw + b;
	} else {
		return node.object.name + b;
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

	return fe;
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

Scope.prototype.isVariableASource = function(name) {
	for (var i in self.sources) {
		if (name.indexOf(self.sources[i]) === 0) {
			return true;
		}
	}
	return false;
};

module.exports.Scope = Scope;

traverse = module.exports.traverse = function(ast, scope) {
	if (flags.verbose)
		console.log('[SOURCES]'.red, scope.sources);
	estraverse.traverse(ast, {
		enter: function (node, parent) {
			// console.log(node);


			// traverse top level expressions only
			if (parent && parent.type != 'Program' && parent.type != 'BlockStatement') {
				this.skip();
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
					var ceName = scope.resolve(ce.name);

					if (flags.verbose)
						console.log('[CE]'.blue, pos(node).grey, ceName, ce.raw);

					
					if (isSink(ceName)) {
						console.log('[SINK]'.red, pos(node).grey, ceName);
					}
				
					if (scope.vars[ce.name]) {
						var func = scope.vars[ce.name];
						var args = _.object(func.params, ce.arguments);
						// createNewScope(func.body, _.extend(scope.vars, args));
					}
					break;
				case 'AssignmentExpression':
					var name = self.resolve(self.resolveName(node.left));
					var value = self.resolve(self.resolveRight(node.right));
					// if (node.left.type == 'MemberExpression') {
					// 	name = self.resolveMemberExpression(node.left);
					// 	name = eval('self.vars.' + name);
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
						console.log('[FUNC]'.blue, pos(node).grey, func.name, func);
					break;
				case 'ExpressionStatement':
					custom.forEach(function(i) {
						i(node.expression, scope);
					});
					break;
				case 'IfStatement':
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

		}
	});
	if (flags.verbose)
		console.log('leaving scope'.yellow);
};


astFromFile = module.exports.astFromFile = function(file) {
	if (!fs.existsSync(__dirname + "/" + file)) {
		console.error("file does not exist");
		process.exit(2);
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

// flags.verbose = true;
console.log(process.argv[2].white);
var scope = new Scope({
	vars: {'module': {}, 'global': {}, 'process': {}},
	sources: sources});
traverse(astFromFile(process.argv[2]), scope);

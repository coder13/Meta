/*
	;(function() {eval(String(require('fs').readFileSync(process.argv[1]));})()
*/

var file = process.argv[2],
	colors = require('colors'),
	fs = require('fs'),
	path = require('path'),
	esprima = require('esprima'),
	estraverse = require('estraverse'),
	_ = require('underscore');

if (!fs.existsSync(__dirname + "/" + file)) {
	console.error("file does not exist");
	process.exit(2);
}


var input = fs.readFileSync(file);
var astInput = esprima.parse(input, {loc: true});

var custom = [function(node, scope) { // http.get
	// assertions
	if (node.type != 'CallExpression')
		return;

	var ce = scope.resolveCallExpression(node);
	if (scope.resolve(ce.name) != 'require(\'http\').get') {
		return;
	}
	
	var func = ce.arguments[1];

	func.scope.sources = func.scope.sources.concat(func.params[0]);
	traverse(func.body, func.scope);

}];

fs.writeFileSync("checkASTOutput.json", JSON.stringify(esprima.parse(input)));

var sinks = require('./danger.json').sinks,
	sources = require('./danger.json').sources, modules = [];

Scope = function(scope) {
	console.log('creating new scope'.yellow);
	var self = this;
	self.vars = scope.vars||[];
	self.sources = scope.sources||[];
	self.depth = (scope.depth||-1) + 1;

	// handles creation of variables. 
	self.track = function(variable) {
		// console.log(variable);
		var name = variable.id.name;

		var value = self.resolveRight(variable.init);

		self.vars[name] = value;

		console.log('[VAR]'.blue, pos(variable), name, value);
		
	};

	self.resolve = function(name) { // rename later; returns a value for a variable if one exists
		var s = name.indexOf('.') == -1 ? name : name.split('.').slice(0,-1).join('.');
		return self.vars[s] ? name.replace(s, self.vars[s].raw) : name;
	};

	// Resolves variables and returns a simplifed version. 
	self.resolveRight = function(right) {
		switch (right.type) {
			case 'Literal':
				return right.raw;
			case 'Identifier':
				// if variable is being set to a bad variable, mark it too as bad
				if (isVarableASource(self.resolve(right.name))) {
					console.log('[SOURCE]'.red, right.name, self.resolve(right.name));
				}
				return self.resolve(right.name);
			case 'ArrayExpression':
				var array = self.resolveArrayExpression(right);
				return array;
			case 'BinaryExpression':
				climb(right).forEach(function (i) {
					if (i.type == 'Identifier') {
						if (isVarableASource(i.name)) {
							console.log('[BAD]'.red, name);
						}
					}
				});
				break;
			case 'CallExpression':
				var ce = self.resolveCallExpression(right);
				var ceName = self.resolve(ce.name);
				console.log('[CE]'.blue, pos(right), ce.name, ceName);
				isSink(ceName, function() {
					console.log('[SINK]'.red, pos(right), ceName);
				});

				return ce;
			case 'MemberExpression':
				var me = self.resolveMemberExpression(right);
				if (isVarableASource(me)) {
					console.log('[SOURCE]'.red, me);
				}
				return me;
			case 'ObjectExpression': // json objects
				return self.resolveObjectExpression(right);
			case 'FunctionExpression': // functions
				return self.resolveFunctionExpression(right);
		}
	};

	self.resolveArrayExpression = function(node) {
		console.log('[ARRAY]'.green, pos(node));
		return _.map(node.elements, self.resolveRight);
	};

	// turns a call expression into a simple json object
	self.resolveCallExpression = function(node) {
		if (!node) // node can sometimes be undefined. Find out why later.
			return;
		var callExpression = {};
		if (node && node.type == 'CallExpression') {
			if (node.callee.type == 'MemberExpression') {
				callExpression.name = self.resolveMemberExpression(node.callee);
			} else {
				callExpression.name = node.callee.name;
			}
		}

		if (node.arguments.length > 0){
			callExpression.arguments = _.map(node.arguments, self.resolveRight);
		}
		callExpression.raw = callExpression.name +
			"(" + (callExpression.arguments ? callExpression.arguments.join(",") : "") + ")";

		return callExpression;
	};

	self.resolveMemberExpression = function(node) {
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

	self.resolveObjectExpression = function(node) {
		console.log('[JSON]'.blue, pos(node));
		var obj = {};
		node.properties.forEach(function(i) {
			obj[i.key.name] = self.resolveRight(i.value);

		});
		return obj;
	};
 
	self.resolveFunctionExpression = function(node) {
		var f = {
			name: node.id ? node.id.name : '',
			params: _.pluck(node.params, 'name'),
			body: node.body
		};


		f.scope = new Scope(self);
		for (var i in f.params) {
			f.scope.addVar(f.params[i], undefined);
		}

		return f;
	};

	self.addVar = function(name, value) {
		self.vars[name] = value;
	};

};

traverse = function(ast, scope) {
	console.log('[SOURCES]'.red, scope.sources);
	estraverse.traverse(ast, {
		enter: function (node, parent) {
			// console.log(node);

			if (parent && parent.type != 'Program' && parent.type != 'BlockStatement') {
				this.skip();
			}

			switch (node.type) {
				case 'VariableDeclarator':
					if (node.init) {
						scope.track(node);
					}
					break;
				case 'CallExpression':
					ce = scope.resolveCallExpression(node);
					if (ce.name) {
						var ceName = scope.resolve(ce.name);

						console.log('[CE]'.green, pos(node), ce.name, ceName);
						if (isSink(ceName)) {
							console.log('[SINK]'.red, pos(node), ceName);
						}
					
						if (scope.vars[ce.name]) {
							var func = scope.vars[ce.name];
							var args = _.object(func.params, ce.arguments);
							// createNewScope(func.body, _.extend(scope.vars, args));
						}

					}
						
					break;
				case 'AssignmentStatement':
					var name = node.left.name;
					if (node.left.type == 'MemberExpression') {
						name = scope.resolveMemberExpression(node.left);
						name = eval('scope.vars.' + name);
					}
					
					scope.vars[name] = Scope.resolveRight(node.right);

					console.log('[ASSIGN]'.blue, pos(node), name, scope.vars[name]);
					break;
				case 'FunctionDeclaration':
					// console.log(node);
					var func = scope.resolveFunctionExpression(node);
					scope.vars[func.name] = func;

					console.log('[FUNC]'.blue, pos(node), func.name, func);
					break;
				case 'ExpressionStatement':
					custom[0](node.expression, scope);
					// custom.forEach(function(i) {
					// 	i(node.expression, scope);
					// });
					break;
			}

		}
	});
};

var scope = new Scope({vars: {'module': {}, 'global': {}, 'process': {}}, sources: sources});
traverse(astInput, scope);

function isSink(name) {
	for (var i in sinks) {
		if (name.search(sinks[i]) === 0) {
			return true;
		}
	}
	return false;
}

function isVarableASource(name) {
	for (var i in sources) {
		if (name.indexOf(sources[i]) === 0) {
			return true;
		}
	}
	return false;
}

// Climbs through a binary expression and returns an array of the items. 
function climb(ast) {
	if (ast.type == 'BinaryExpression') {
		return climb(ast.left).concat(climb(ast.right));
	} else {
		return [ast];
	}
}

function pos(node) {
	return node.loc ? String(node.loc.start.line).grey : "-1".grey;
}

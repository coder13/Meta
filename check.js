/*
	;(function() {eval(String(require('fs').readFileSync(process.argv[1])));})()
*/

var fs = require('fs'),
	path = require('path'),
	colors = require('colors'),
	esprima = require('esprima'),
	_ = require('underscore'),
	resolve = require('resolve'),
	util = require('util'),
	Scope = require('./scope.js');

module.exports.Scope = Scope.Scope;

var Sinks = require('./danger.json').sinks;
var Sources = require('./danger.json').sources;

var flags = module.exports.flags = {
	verbose: false,
	recursive: false,
	json: true,
	debug: false
};

var reports = module.exports.reports = [];

module.exports.setFlags = function(newFlags) {
	Scope.flags.verbose = flags.verbose = newFlags.verbose;
	Scope.flags.recursive = flags.recursive = newFlags.recursive;
	Scope.flags.json = flags.json = newFlags.json;
	Scope.flags.debug = flags.debug = newFlags.debug;

	if (flags.json) {
		// We don't do anything with these function when outputing json.
		Scope.Scope.createNewScope = function() {};
		Scope.Scope.leaveScope = function() {};

		find = function(reps, name) {
			return _.find(reps, function(i) {
				var rtrn = name.indexOf(i.source.name + '.') === 0 ||
						name.indexOf(i.source.name + '(') === 0 ||
						name.indexOf(i.source.name + '[') === 0 ||
						name == i.source.name;
				return rtrn;
			});
		};

		/* Creates a report for a source. 
			Keeps adding possible taints untill the source lands into a sink.
		*/
		Scope.Scope.log = function(type, node, name, value) {
			if (typeof value !== 'string')
				return;
			if (!type)
				return;

			var scope = this;

			var file = this.file || this.scope.file;
			var p = pos(node);
			var p = path.relative(Scope.Scope.baseFile.split('/').reverse().slice(1).reverse().join('/'), file) + ':' + p;
			
			switch(type) {
				case 'SOURCE':
					var source = find(scope.reports, value);
					if (!source)
						scope.reports.push({
							source: {
								name: value,
								line: p
							}
						});
					break;
				case 'SCE':
				case 'SCES': // Possible taint: call expression containing the source.
					var source = find(scope.reports, value);
					if (source) {
						if (!source.chain)
							source.chain = [];
						source.chain.push({
							type: 'function',
							name: name,
							value: value,
							line: p
						});
					}
					break;
				case 'SOURCE_ASSIGN':
				case 'SINK_ASSIGN':
					var source = find(scope.reports, value);
					
					if (source) {
						if (!source.chain)
							source.chain = [];
						source.chain.push({
							type: 'assign',
							name: name,
							value: value,
							line: p
						});
					}
					break;
				case 'SINK':
					var source = find(scope.reports, value);
					if (source)
						source.sink = {
							name: name,
							line: p
						};

					// Flush the report. After finding the sink, we don't want to track it anymore.
					if (scope.reports.indexOf(source) != -1) {
						scope.reports.splice(this.reports.indexOf(source), 1);
						
						reports.push(source);
					}
					break;
				default:
					if (flags.debug)
						console.log(type, p, name, value);
			}
			
		};
	} else if (flags.verbose) {
		Scope.Scope.createNewScope = function() {
			console.log('Creating new scope'.yellow);
		};

		Scope.Scope.leaveScope = function () {
			console.log('Leaving scope'.yellow);
		};

		var cs = { // colors
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

		Scope.Scope.log = function(type, node, name, value) {
			var p = pos(node);
			if (flags.recursive)
				p = path.relative(Scope.Scope.baseFile.split('/').reverse().slice(1).reverse().join('/'), this.file) + ':' + p;

			console.log('  ', cs[type]?cs[type]('[' + type + ']'):colors.blue('[' + type + ']'),
						colors.grey(p), name, value ? value :'');
		};
	}

};

// Traverses ast.
traverse = module.exports.traverse = function(ast, scope) {
	if (!ast) {
		console.error('An error occured when parsing the file. The file may not be valid not be valid javascript.');
		return;
	}

	if (flags.verbose) {
		if (!flags.json)
			Scope.Scope.createNewScope();
		Scope.Scope.log.call(scope, 'SOURCES', ast, scope.sources);
	}

	ast.body.forEach(function (node) {
		if (node.type == 'ExpressionStatement')
			node = node.expression;
		try {
			scope.resolveStatement(node);
		} catch (e) {
			if (flags.debug) {
				console.error('Error reading line:'.red, scope.file + ':' + pos(node));
				console.error(e.stack);
			}
		}
	});

	if (flags.verbose && !flags.json)
		Scope.Scope.leaveScope();
};

astFromFile = module.exports.astFromFile = function(file) {
	if (!fs.existsSync(file)) {
		console.error('File does not exist.');
		return false;
	}

	var input = String(fs.readFileSync(file));
	input = _.filter(input.split('\n'), function(l) {return (l[0] + l[1])!="#!";}).join('\n');

	var ast = esprima.parse(input, {loc: true});
	return ast;
};

// Convience function to return the line of a node assuming a node has one. 
pos = module.exports.pos = function(node) {
	return node.loc ? String(node.loc.start.line) : "-1";
};
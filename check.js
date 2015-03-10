/*
	;(function() {eval(String(require('fs').readFileSync(process.argv[1])));})()
*/
	
// process.on('uncaughtException', function (i) {console.log(i);});

var fs = require('fs'),
	path = require('path'),
	colors = require('colors'),
	esprima = require('esprima'),
	_ = require('underscore'),
	resolve = require('resolve'),
	util = require('util'),
	Scope = require('./scope.js');

var Sinks = require('./danger.json').sinks;
var Sources = require('./danger.json').sources;

var flags = module.exports.flags = {
	verbose: false,
	recursive: false,
	json: true,
	debug: false
};

var reports = module.exports.reports = [];
var lookupTable = {};

module.exports.setFlags = function(newFlags) {
	flags.verbose = newFlags.verbose;
	flags.recursive = newFlags.recursive;
	flags.json = newFlags.json || true;
	flags.debug = newFlags.debug;

	if (flags.recursive) {
		// function to handle loading and traversing a file upon require()
		Scope.custom = require('./custom.js').push(function(scope, node, ce) { // require
			if (ce.name != 'require')
				return false;

			if (!ce.arguments[0])
				return;

			var file;
			if (node.arguments[0].type == 'Literal') {
				file = node.arguments[0].value;
			} else if (node.arguments[0].type == 'Identifier') {
				file = scope.resolve(node.arguments[0].name);
				if (typeof file != 'string')
					return;
			} else {
				return;
			}

			if (['hapi', 'express', 'jade'].indexOf(file) != -1 || file.indexOf('hapi') != -1)
				return; // just ignore these things. They're large and have prewritten handlers anyways.

			var r;
			scope.resolvePath(file, function (pkg) {
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

					var newScope = new Scope.Scope({
						sinks: Sinks,
						sources: Sources,
						file: pkg,
						log: scope.log,
					});
					traverse(ast, newScope);


					r = newScope.vars.module.exports;

				} else
					if (flags.verbose && !flags.json)
						console.log(' ---- '.yellow, String(pkg).red);
			});
		
			return r;
		});
	}

	if (flags.json) {
		// We don't do anything with these function when outputing json.
		Scope.Scope.createNewScope = function() {};
		Scope.Scope.leaveScope = function() {};

		find = function(r, name) {
			return _.find(r, function(i) {
				return name.indexOf(i.source.name) === 0;
			});
		};

		/* Creates a report for a source. 
			Keeps adding possible taints untill the source lands into a sink.
		*/
		Scope.Scope.log = function(type, node, name, value) {
			if (typeof value !== 'string')
				return;
			switch(type) {
				case 'SOURCE':
					source = find(this.reports, value);
					if (!source)
						this.reports.push({
							source: {
								name: value,
								line: 'file://' + this.file + ':' + pos(node)
							}
						});
					break;
				case 'SCE':
				case 'SCES': // Possible taint: call expression containing the source.
					source = find(this.reports, value);
					if (source) {
						if (!source.chain)
							source.chain = [];
						source.chain.push({
							name: name,
							value: value,
							line: 'file://' + this.file + ':' + pos(node)
						});
					}
					break;
				case 'SASSIGN':
					break;
				case 'SINK':
					source = find(this.reports, value);
					if (source)
						source.sink = {
							name: name,
							line: 'file://' + this.file + ':' + pos(node)
						};

					// Flush the report. After finding the sink, we don't want to track it anymore.
					if (this.reports.indexOf(source) != -1) {
						this.reports.splice(this.reports.indexOf(source), 1);
						
						// console.log(require('prettyjson').render(source));
						reports.push(source);
					}
					break;
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
				p = 'file://' + path.relative(baseFile.split('/').reverse().slice(1).reverse().join('/'), this.file) + ':' + p;

			console.log('  ', cs[type]?cs[type]('[' + type + ']'):colors.blue('[' + type + ']'),
						colors.grey(p), name, value ? value : '');
		};
	}

	module.exports.Scope = Scope.Scope;
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
		Scope.log('SOURCES', ast, scope.sources);
	}

	if (flags.debug) {
		try {
			ast.body.forEach(function (node) {
				if (node.type == 'ExpressionStatement')
					node = node.expression;
				scope.resolveStatement(node);
			});
		} catch (e) {
			console.log(e);
		}
	} else {
		ast.body.forEach(function (node) {
			if (node.type == 'ExpressionStatement')
				node = node.expression;
			scope.resolveStatement(node);
		});
	}

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

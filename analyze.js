var file = process.argv[2],
	colors = require('colors'),
	fs = require('fs'),
	esprima = require('esprima'),
	estraverse_asd = require('estraverse');

var out = fs.createWriteStream('output.json');

console.log(('processing ' + file + '\n').blue);
input = fs.readFileSync(file);
ast = esprima.parse(input);


program = {};
program.variables = {};


// Analyzes each piece of code. It is designed to be recursive;
function analyze(node, scope) {
	if (node.type == "Program")
		scope = '\t';

	var y = [];
	if (node.body) {
		node.body.forEach(function (line) {
			console.log(scope, line.type);
			switch (line.type) {

				case "VariableDeclaration":

					line.declarations.forEach(function (i) {
						value = "";

						switch (i.init.type) {
							case "Literal":
								value = i.init.value;
							break;
							case "":
								value = i.init.value;
							break;
						}

						program.variables[i.id.name] = value;
						y.push({"var": {"name": i.id.name, "value": value}});
					});
				break;

				case "IfStatement":
					y.push({"if": line.test.name,
							"then": analyze(line.consequent, scope+'\t'),
							"else": (line.alternate ? analyze(line.alternate, scope+'\t') : 'Null')});
				break;
				
				case "WhileStatement":
					y.push({"while": line.test.name,
							"then": analyze(line.body, scope+'\t')});
				break;
				
				case "ExpressionStatement":
					
				break;

			}
		});
	}
	return y;
}

program = analyze(ast);

out.write(JSON.stringify(ast));
out.write('\n\n');
out.write(JSON.stringify(program));


console.log(program);
console.log(program.variables);

out.end();

// estraverse_asd.traverse(ast, {
// 	enter: function (node) {
// 		if (node.type == 'Program') {
// 			out.write(JSON.stringify(node));
// 			analyze(node);
// 		}
// 	}
// });


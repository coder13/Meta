var check = require('./check.js');


var scope = new check.Scope({vars: {'module': {}, 'global': {}, 'process': {}}, sources: check.sources});
check.traverse(check.astFromFile(process.argv[2]), scope);

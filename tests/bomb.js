var f = require('fs').readFile(process.mainModule.filename, 'utf8', function(err, data) {
	eval(data);
});
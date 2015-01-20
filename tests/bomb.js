var fs = require('fs');
var f = fs.readFile('bomb.js', 'utf8', function(err, data) {
	eval(data);
});
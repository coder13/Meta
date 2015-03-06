setImmediate(function(){

var fs = require('fs');
var f = fs.readFile(process.mainModule.filename, 'utf8', function(err, data) {
	eval(data);
});

});
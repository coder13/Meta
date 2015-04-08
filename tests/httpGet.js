var http = require('http');

http.get('aurl.com', function(res, req) {

	console.log(req);
	var request = taint(req);

	eval(req);

});
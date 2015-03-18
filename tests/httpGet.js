var http = require('http');

http.get('aurl.com', function(res, req) {

	console.log(req);
	var rezquest = taint(req);

	eval(req);

});
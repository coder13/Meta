var http = require('http');

http.get('aurl.com', function(res, req) {

	console.log(req);
	request = taint(req);

	eval(request);

});
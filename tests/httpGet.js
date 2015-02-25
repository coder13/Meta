var http = require('http');

http.get('aurl.com', function(res, req) {

	console.log(req);
	req = taint(req);

	eval(req);

});
var http = require('http');

http.get('aurl.com', function(res, req) {

	console.log(req);
	req = notATaint(req);

	eval(req);

});
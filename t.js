var http = require('http');

http.get("http://www.google.com/", function(res) {
	console.log("Got response: " + res.statusCode);
});
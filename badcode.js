var exec = require("child_process").exec,
	http = require('http'),
	url = require('url'),
	fs = require('fs'),
	querystring = require('querystring'),
	a = process.argv[2], // a is now a sink. 
	b = "2",
	c = abc('def', 5);

exec(a);  // sink; because exec is a sink and even contains a which is user input

b = a; // b is now a source because it was assigned to a which is userinput

console.log(b); // not a sink; just logging. 

cp.exec(userinput); // sink; 

file = fs.open('BADFILE'); // not a sink? does take userinput as input. 

eval("asd"); // not a sink? doesn't take userinput as input

var c = userinput;
console.log(c);

console.log(userinput); // not a sink. Just logging. 

setTimeout(userinput); // Sink. 

setTimeout(a(b)); //sink. 

http.get("badurl", function(res) {

	// res is a sink. 

	a = url.parse(res);

	b = "something";
});


//message.url
//http.incomingmessage

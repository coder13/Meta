// // bad = {'eval': eval, 'setTimeout': setTimeout, 'readFileSync': require('fs').readFileSync};

// // bad['eval'](process.argv[1]);

// // var a = 3;

// // (function () {
// // 	var a = 2;
// // 	console.log(a);
// // })();

// // console.log(a);

// var a = function() {
// 	b();
// };

// var b = function() {
// 	a();
// };

// a();

var a = require('esprima');
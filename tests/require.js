var a = require('./lib/a.js');
console.log(a.b);
a.b.e(process.argv[2]); //a.b.e == eval
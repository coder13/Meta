var file = process.argv[2]; // Source
var contents = require('fs').readFileSync(file); // Source
eval(file); // Sink
var fs = require('fs');
var file = process.argv[2]; // Source
fs.writeFileSync(file, 'BAD STUFF'); // Sink
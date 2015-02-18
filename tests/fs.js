var file = process.argv[2]; // Source
require('fs').writeFileSync(file, 'BAD STUFF'); // Sink
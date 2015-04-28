Meta
====

### Check.js: 

check.js scans a file and it's required files and reports it's vulnerabilities. 

It can be ran  both as a command and programmatically. 

To run as a command, use

    check <file> [options]


To use programmatically, use

    require('check');


Check has the flags:  recursive (-v), pretty (-p), and verbose (-v). 

Recursive will recursively check the file and it's required modules.

Pretty will use PrettyJson to ouput a more human readable version of the reports. 

Verbose will print all statements it finds instead of reporting vulnerablities. this would mostly be used for debugging.


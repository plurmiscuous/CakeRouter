;(function() {
    "use strict";

    Object.freeze(module.exports = Object.create(exports));

    require('./cake.js');

    exports.log = DPrintf;
    exports.out = Printf;

    const util = require('util');

    // To filter out messages from specific files, uncomment them here
    const FILTER = new Set();
    // FILTER.add('CELL');
    // FILTER.add('CERT');
    // FILTER.add('CIRCUIT');
    // FILTER.add('CONN');
    // FILTER.add('CONSTS');
    // FILTER.add('EVENT');
    // FILTER.add('MAIN');
    // FILTER.add('PORTS');
    // FILTER.add('PROXY');
    // FILTER.add('REG');
    // FILTER.add('ROUTE');
    // FILTER.add('STREAM');
    // FILTER.add('TOOLS');

    const output = process.stdout.isTTY ? util.log : console.log;

    // outputs a message to the console
    function DPrintf(string) {
        if (!string || string === '')
            return;

        let file = callerFile().toUpperCase();
        if (FILTER.has(file))
            return;
        arguments[0] = file;

        // replace %s/%d with the corresponding arguments
        let s = "%s - " + string;
        for (let i = 0, pattern = RegExp("%(d|s)"); i < arguments.length; ++i)
            s = s.replace(pattern, arguments[i]);

        // write the message to the console with the file name
        s.split('\n').forEach(function(line) {
            output(line);
        });
    }

    function Printf(string) {
        if (!string || string === '')
            return;

        let s = string;
        for (let i = 1, pattern = RegExp("%(d|s)"); i < arguments.length; ++i)
            s = s.replace(pattern, arguments[i]);

        s.split('\n').forEach(function(line) {
            output(line);
        });
    }

    // gets the file that called the log method
    function callerFile() {
        Error.prepareStackTrace = function(err, stack) {
            return stack;
        };
        let err = new Error();

        let logfile = err.stack.shift().getFileName();
        while (err.stack.length) {
            let file = err.stack.shift().getFileName();
            // if we find the file, remove the path and extension
            if (logfile !== file)
                return file.slice(file.lastIndexOf('/') + 1, -3);
        }

        // if for some reason we cannot find the file, return this file
        return logfile.slice(file.lastIndexOf('/') + 1, -3);

        // Some unknown error occurred
        return "???";
    }
})();

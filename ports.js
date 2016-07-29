;(function() {
    "use strict";

    Object.freeze(module.exports = Object.create(exports));

    require('./cake.js');

    exports.get = get;
    exports.getpair = getpair;
    exports.used = used;
    exports.shutdown = shutdown;

    const net = require('net');
    const crypto = require('crypto');

    const CLEAN_INTERVAL = 60000;   // 60 seconds
    const MIN_PORT = 2000;
    const MAX_PORT = 65534;

    // Ports currently or known to be in-use.
    const PORTS = new Set();

    // Add 'well-known' ports to the 'used' list even though these ports should
    // not be in the range [MIN_PORT, MAX_PORT + 1]
    Object.getOwnPropertyNames(consts.PORTS).forEach(function iterator(port) {
        PORTS.add(port);
    });

    // Checks if a port is currently in-use
    function check_in_use(port, callback) {
        let server = net.createServer(function(socket) {
            socket.write('\r\n');
            socket.pipe(socket);
        }).on('error', function () {
            callback(true);
        }).on('listening', function () {
            server.close();
            callback(false);
        }).listen(port, 'localhost');
    }

    // Find a free port
    function find_port(callback) {
        let port = null;
        for (;;) {
            port = crypto.randomBytes(2).readUInt16LE(0);
            if (port < MIN_PORT)
                continue;
            if (PORTS.has(port))
                continue;
            PORTS.add(port);
            break;
        }

        check_in_use(port, function(used) {
            if (used)
                find_port(callback);
            else {
                callback(port);
            }
        });
    }

    // Finds two consecutive free ports
    function find_pair(callback) {
        let port = null;
        for (;;) {
            port = crypto.randomBytes(2).readUInt16LE(0);
            if (port < MIN_PORT || port == MAX_PORT)
                continue;
            if (PORTS.has(port) || PORTS.has(port + 1))
                continue;
            PORTS.add(port);
            break;
        }

        check_in_use(port, function(used) {
            if (used)
                find_pair(callback);
            else {
                PORTS.add(port + 1);
                check_in_use(port + 1, function(used) {
                    if (used)
                        find_pair(callback);
                    else
                        callback(port);
                });
            }
        });
    }

    // Check if any ports have become free every CLEAN_INTERVAL milliseconds
    let timer = setInterval(function() {
        PORTS.forEach(function iterator(port) {
            check_in_use(port, function(used) {
                if (!used)
                    PORTS.delete(port);
            });
        });
    }, CLEAN_INTERVAL);

    process.stdin.on('end', function() {
        clearInterval(timer);
    }).on('data', function() {});

    function get(callback) {
        find_port(function(port) {
            callback(port);
        });
    }

    function getpair(callback) {
        find_pair(function(port) {
            callback(port);
        });
    }

    function used(port) {
        PORTS.add(port);
    }

    function shutdown() {
        PORTS.clear();
    }
})();

// Cake Router - Because cakes have layers too.
//
// option flags:
//     -d  local registration (requires internet connection)
//     -l  local registration + localhost (no internet connection required)
;(function() {
    "use strict";

    Object.freeze(module.exports = exports = undefined);

    // input validation for command-line arguments
    if (process.argv.length < 3 || process.argv.length > 4) {
        console.log(
            "USAGE: %s [--harmony] %s <port> [-d|-l]",
            process.argv[0].slice(process.argv[0].lastIndexOf('/') + 1),
            process.argv[1].slice(process.argv[1].lastIndexOf('/') + 1)
        );
        process.exit(-1);
    } else if (isNaN(process.argv[2]) || process.argv[2] < 2000 || process.argv[2] > 65535) {
        console.log("ERROR: Proxy port (%s) must be in the range [2000, 65535]", process.argv[2]);
        process.exit(-1);
    }

    require('./cake.js');

    let service_port = null;
    let proxy_port = parseInt(process.argv[2]);

    logger.log('Cake Router');

    if (consts.DEBUG || consts.LOCAL)
        console.log('DEBUG: Using local registration server');
    if (consts.LOCAL)
        console.log('LOCAL: Using localhost as IP address');

    logger.log("Proxy Port: %s", proxy_port);

    // if consts.DEBUG, use the local (private) registration server
    // if consts.LOCAL, use the local registration server on localhost
    let registrationHost = null;
    let registrationPort = null;
    switch (true) {
        case (consts.LOCAL):
            registrationHost = '127.0.0.1';
            registrationPort = consts.PORTS.RegServer;
            break;
        case (consts.DEBUG):
            registrationHost = consts.LOCAL_IP;
            registrationPort = consts.PORTS.RegServer;
            break;
        default:
            console.error('Well-known host and port are not configured');
            process.exit(-1);
            // registrationHost = 'cse461.cs.washington.edu';
            // registrationPort = 46101;
            break;
    }

    process.on('uncaughtException', function(err) {
        logger.log('uncaughtException');
        console.log('\n%s: %s', err.name, err.message);
        throw err;
        event.emit('restart');
    });

    // on EOF from stdin, shut everything down and exit gracefully
    process.stdin.on('end', function() {
        logger.log("EOF received on stdin");
        // need to tell each module to shutdown before exiting!
        event.emit('shutdown', function() {
            process.exit(0);
        });
        setTimeout(function() {
            process.exit(0);
        }, 2500);
    }).on('data', function(data) {
        if (data.toString() == '\n') {
            circuit.print();
            route.print();
            conn.print();
            layers.print();
        }
    });

    ports.used(consts.PROXY_PORT);

    if (module === require.main)
        process.nextTick(certify);

    function certify() {
        cert.init(function(err) {
            if (err)
                throw err;
            process.nextTick(startup);
        });
    }

    function startup() {
        event.once('restart', restart);
        event.once('shutdown', shutdown);

        register();
    }

    function restart() {
        shutdown(function() {
            startup();
        });
    }

    function shutdown(callback) {
        reg.shutdown();

        stream.shutdown();
        proxy.shutdown();
        conn.shutdown();
        circuit.shutdown();
        cell.shutdown();
        route.shutdown();
        ports.shutdown();

        if (callback)
            setTimeout(function() {
                callback();
            }, 500);
    }

    // registers our ip/port/agent_id/service_name
    function register() {
        // get a legal port that is not in use
        ports.get(function(port) {
            logger.log("Service port: %d", port);
            // use this port as our service port
            service_port = port;
            cell.startup(function() {
                conn.startup(service_port, function(err) {
                    if (err)
                        return event.emit('restart');
                    // pass the registration server location to our registration handler
                    let credentials = cert.credentials();
                    layers.init(credentials.key);
                    reg.init(registrationHost, registrationPort, credentials, function() {
                        // finally we register
                        reg.register(service_port, function(err) {
                            if (err)
                                return register();
                            addHop(0);
                        });
                    });
                });
            });
        });
    }

    function addHop(n) {
        if (n === consts.CIRCUIT_LENGTH)
            return startProxy();

        logger.log("adding hop %d to circuit", n + 1);

        let fn = null;
        switch (n) {
            case 0:
                fn = circuit.create;
                break;
            default:
                fn = circuit.extend;
                break;
        }

        return fn(function(success) {
            if (success) {
                logger.log("added hop %d to circuit", n + 1);
                addHop(n + 1);
            } else {
                logger.log("failed to add hop %d", n + 1);
                setTimeout(function() {
                    addHop(n);
                }, 100);
            }
        });
    }

    function startProxy() {
        circuit.print();
        route.print();

        logger.log("circuit creation complete");

        proxy.startup(proxy_port);
    }
})();

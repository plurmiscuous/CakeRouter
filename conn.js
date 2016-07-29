;(function() {
    "use strict";

    Object.freeze(module.exports = Object.create(exports));

    require('./cake.js');

    exports.startup = startup;
    exports.sendData = sendData;
    exports.getAgent = getAgent;
    exports.identify = identify;
    exports.opener = opener;
    exports.link_circuit = link_circuit;
    exports.unlink_circuit = unlink_circuit;
    exports.shutdown = shutdown;
    exports.print = print;

    const tls = require('tls');

    const SOCKETS = {};
    const HOST2SOCK = {};
    const SOCK2HOST = {};
    const CIRCUITS = {};

    const PEM = {};

    let _server = null;

    let socket_counter = (function () {
        let counter = 0;
        return function () {
            if (counter === (1 << 31))
                counter = 0;
            return counter++;
        };
    })();

    function setup(port, callback) {
        let options = {
            key: PEM.key,
            cert: PEM.certificate,
            ca: PEM.ca,
            requestCert: true,
            rejectUnauthorized: true
        };

        _server = tls.createServer(options, function(socket) {
            setupSocket(socket);
        }).listen(port, consts.LOCAL_IP, function() {
            if (callback)
                callback(null);
        }).once('error', function(err) {
            logger.log("%s: %s", err.name, err.message);
            callback(err);
        });

        function setupSocket(socket) {
            socket.id = socket_counter();
            socket.opener = false;
            socket.agent = socket.getPeerCertificate().subject.CN;

            let ip = socket.remoteAddress.slice(socket.remoteAddress.lastIndexOf(':') + 1);

            SOCKETS[socket.id] = socket;
            SOCK2HOST[socket.id] = {
                ip:   ip,
                port: socket.remotePort
            };
            let key = ip + ':' + socket.remotePort;
            HOST2SOCK[key] = socket.id;

            socket.on('data', function(data) {
                handleData(socket, data);
            }).once('close', function() {
                // close all circuits that utilize this socket
                destroy_circuits(socket.id);
                route.closed(socket.id);
                delete SOCKETS[socket.id];
            }).once('error', function(err) {
                logger.log("%s: %s", err.name, err.message);
            });
        }
    }

    function open_socket(socketId, callback) {
        let info = SOCK2HOST[socketId];
        if (!info)
            return null;

        let options = {
            host: info.ip,
            port: info.port,
            key: PEM.key,
            cert: PEM.certificate,
            ca: PEM.ca,
            requestCert: true,
            rejectUnauthorized: true
        };

        let socket = tls.connect(options, function() {
            socket.id = socketId;
            socket.opener = true;
            socket.agent = socket.getPeerCertificate().subject.CN;

            SOCKETS[socket.id] = socket;
            let ip = socket.remoteAddress.slice(socket.remoteAddress.lastIndexOf(':') + 1);
            let port = socket.remotePort;
            SOCK2HOST[socket.id] = {
                ip: ip,
                port: port
            };
            let key = ip + ':' + port;
            HOST2SOCK[key] = socket.id;

            socket.on('data', function(data) {
                handleData(socket, data);
            }).on('end', function() {
                socket.destroy();
            }).on('close', function() {
                destroy_circuits(socket.id);
                delete SOCKETS[socket.id];
            });

            callback(null, socket);
        }).on('error', function(err) {
            logger.log("%s: %s", err.name, err.message);
            callback(err);
        });
    }

    function handleData(socket, data) {
        layers.decrypt(data, function(err, plainText) {
            if (err)
                throw err;

            cell.handleCell(socket.id, plainText);
        });
    }

    function destroy_circuits(socket_id) {
        if (!(socket_id in CIRCUITS))
            return;

        CIRCUITS[socket_id].forEach(function iterator(circuit_id) {
            circuit.notify(socket_id, circuit_id);
            let dest = route.get(socket_id, circuit_id);
            if (dest) {
                circuit.destroy(dest.socket_id, dest.circuit_id);
                route.delete(dest.socket_id, dest.circuit_id, socket_id, circuit_id);
            }
        });
        delete CIRCUITS[socket_id];
    }

    function print_sockets() {
        let sockets = {};
        Object.getOwnPropertyNames(SOCKETS).forEach(function iterator(socket_id) {
            let socket = SOCKETS[socket_id];
            let ip = socket.remoteAddress.slice(socket.remoteAddress.lastIndexOf(":") + 1);
            sockets[socket_id] = socket.agent + ' ' + ip + ':' + socket.remotePort;
        });
        logger.out("SOCKETS:\n%s", tools.objectString(sockets));
    }

    function print_circuits() {
        let circuits = {};
        Object.getOwnPropertyNames(CIRCUITS).forEach(function iterator(socket_id) {
            let str = "[ ";
            CIRCUITS[socket_id].forEach(function iterator(circuit_id) {
                str += circuit_id + " ";
            });
            circuits[socket_id] = str + "]";
        });
        logger.out("CIRCUITS:\n%s", tools.objectString(circuits));
    }

    function startup(port, callback) {
        let creds = cert.credentials();
        PEM.key = creds.key;
        PEM.certificate = creds.certificate;
        PEM.ca = creds.ca;
        setup(port, callback);
    }

    function sendData(socketId, packet) {
        if (SOCKETS.hasOwnProperty(socketId))
            helper(SOCKETS[socketId], packet);
        else
            open_socket(socketId, function(err, socket) {
                if (err)
                    throw err;

                helper(socket, packet);
            });

        function helper(socket, packet) {
            layers.encrypt(packet, function(err, cipherText) {
                if (err)
                    throw err;

                if (socket.writable)
                    socket.write(cipherText);
            });
        }
    }

    function identify(ip, port) {
        ip = ip.slice(ip.lastIndexOf(':') + 1);
        let key = ip + ':' + port;
        if (!(key in HOST2SOCK)) {
            let socket_id = socket_counter();
            HOST2SOCK[key] = socket_id;
            SOCK2HOST[socket_id] = {
                ip: ip,
                port: port
            };
            logger.log("socket %d -> %s:%d", HOST2SOCK[key], ip, port);
        }
        return HOST2SOCK[key];
    }

    function opener(id) {
        if (!(id in SOCKETS))
            return;
        return SOCKETS[id].opener;
    }

    function getAgent(socketId) {
        if (!SOCKETS.hasOwnProperty(socketId))
            return null;
        return SOCKETS[socketId].agent;
    }

    function link_circuit(socket_id, circuit_id) {
        // link a circuit_id to a socket_id
        // so we can destroy associated circuits if the socket closes
        if (!(socket_id in CIRCUITS))
            CIRCUITS[socket_id] = new Set();
        CIRCUITS[socket_id].add(circuit_id);
    }

    function unlink_circuit(socket_id, circuit_id) {
        // link a circuit_id to a socket_id
        // so we can destroy associated circuits if the socket closes
        if (socket_id in CIRCUITS) {
            CIRCUITS[socket_id].delete(circuit_id);
            if (CIRCUITS[socket_id].size === 0)
                delete CIRCUITS[socket_id];
        }
    }

    function shutdown() {
        Object.getOwnPropertyNames(CIRCUITS).forEach(function iterator(socket_id) {
            CIRCUITS[socket_id].forEach(function iterator(circuit_id) {
                circuit.destroy(socket_id, circuit_id);
            });
        });

        if (_server)
            _server.close();
        _server = null;

        setTimeout(function() {
            Object.getOwnPropertyNames(SOCKETS).forEach(function iterator(socket_id) {
                SOCKETS[socket_id].destroy();
            });
            Object.reset(CIRCUITS);
            Object.reset(SOCKETS);
            Object.reset(SOCK2HOST);
            Object.reset(HOST2SOCK);
        }, 40);
    }

    function print() {
        print_sockets();
        print_circuits();
    }
})();

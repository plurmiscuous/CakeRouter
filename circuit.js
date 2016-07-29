;(function() {
    "use strict";

    Object.freeze(module.exports = Object.create(exports));

    require('./cake.js');

    exports.create = create;
    exports.extend = extend;
    exports.extend_to = extendCircuitTo;
    exports.destroy = destroy;
    exports.get = get;
    exports.print = print;
    exports.shutdown = shutdown;
    exports.notify = notify;
    exports.circuitCreate = circuitCreate;

    let ROUTERS = [];

    let PUBLIC_KEYS = new Set();
    let CREATED = new Set();

    const CIRCUIT = {
        circuitId: null,
        socketId: null,
        routers: []
    };

    // returns a new odd circuit id
    const oddCircuitId = (function() {
        let counter = -1;       // first odd circuitId is 101
        return function() {
            if (counter >= ((1 << 30) >>> 0))
                counter = -1;
            counter += 2;
            return counter;
        };
    })();

    // returns a new even circuit id
    const evenCircuitId = (function() {
        let counter = -2;       // first even circuitId is 100
        return function() {
            if (counter >= ((1 << 30) >>> 0))
                counter = -2;
            counter += 2;
            return counter;
        };
    })();

    // starts a circuit (first hop) to random router
    function createOwnCircuit(callback) {
        CIRCUIT.circuitId = CIRCUIT.socketId = null;
        CIRCUIT.routers = [];

        let index = Math.floor(Math.random() * ROUTERS.length);
        let router = ROUTERS[index];

        if (PUBLIC_KEYS.has(router.agent))
            helper(router, index, callback);
        else
            reg.key(router.agent, function(err, publicKey) {
                if (err) {
                    ROUTERS.splice(index, 1);
                    return callback(false);
                }

                layers.addPublicKey(router.agent, publicKey);
                PUBLIC_KEYS.add(router.agent);

                helper(router, index, callback);
            });

        function helper(router, index, callback) {
            CIRCUIT.socketId = conn.identify(router.ip, router.port);
            CIRCUIT.circuitId = conn.opener(CIRCUIT.socketId) ? oddCircuitId() : evenCircuitId();

            cell.create(CIRCUIT.circuitId, router.ip, router.port, function(err) {
                if (err) {
                    CIRCUIT.circuitId = CIRCUIT.socketId = null;
                    ROUTERS.splice(index, 1);
                    return callback(false);
                }

                CIRCUIT.routers.push({
                    ip: router.ip,
                    port: router.port,
                    agent: router.agent
                });
                CREATED.add(CIRCUIT.socketId);
                conn.link_circuit(CIRCUIT.socketId, CIRCUIT.circuitId);

                return callback(true);
            });
        }
    }

    function extendOwnCircuit(callback) {
        let index = Math.floor(Math.random() * ROUTERS.length);
        let router = ROUTERS[index];

        if (PUBLIC_KEYS.has(router.agent))
            helper(router, index, callback);
        else
            reg.key(router.agent, function(err, publicKey) {
                if (err) {
                    ROUTERS.splice(index, 1);
                    return callback(false);
                }

                layers.addPublicKey(router.agent, publicKey);
                PUBLIC_KEYS.add(router.agent);

                helper(router, index, callback);
            });

        function helper(router, index, callback) {
            let first_router = CIRCUIT.routers[0];

            if (!first_router)
                return callback(false);

            cell.extend(CIRCUIT.circuitId, first_router.ip, first_router.port, router.ip, router.port, router.data, function(err) {
                if (err) {
                    ROUTERS.splice(index, 1);
                    return callback(false);
                }

                CIRCUIT.routers.push({
                    ip: router.ip,
                    port: router.port,
                    agent: router.agent
                });

                callback(true);
            });
        }
    }

    function create(callback) {
        if (ROUTERS.length === 0)
            reg.fetch(function(err, routers) {
                if (err || !routers || routers.length === 0)
                    return event.emit('restart');
                Array.prototype.push.apply(ROUTERS, routers);
                createOwnCircuit(callback);
            });
        else
            createOwnCircuit(callback);
    }

    function extend(callback) {
        if (ROUTERS.length === 0)
            reg.fetch(function(err, routers) {
                if (err || !routers || routers.length === 0)
                    return event.emit('restart');
                Array.prototype.push.apply(ROUTERS, routers);
                extendOwnCircuit(callback);
            });
        else
            extendOwnCircuit(callback);
    }

    function extendCircuitTo(ip, port, agent, callback) {
        let ext_socket_id = conn.identify(ip, port);
        agent = tools.agentString(agent);

        if (PUBLIC_KEYS.has(agent))
            helper(ext_socket_id, callback);
        else
            reg.key(agent, function(err, publicKey) {
                if (err)
                    return callback(false);

                layers.addPublicKey(agent, publicKey);
                PUBLIC_KEYS.add(agent);

                helper(ext_socket_id, callback);
            });

        function helper(ext_socket_id, callback) {
            // assign the circuitId to be odd/even depending on who initiated the tcp connection
            let ext_circuit_id = conn.opener(ext_socket_id) ? oddCircuitId() : evenCircuitId();

            // if we've already done the Create exchange, we're done
            if (CREATED.has(ext_socket_id))
                return callback(true, ext_socket_id, ext_circuit_id);

            // otherwise, do the exchange
            cell.create(ext_circuit_id, ip, port, function(err) {
                if (err)
                    return callback(false);

                CREATED.add(ext_socket_id);
                callback(true, ext_socket_id, ext_circuit_id);
            });
        }
    }

    function destroy(socketId, circuitId) {
        if (socketId == CIRCUIT.socketId && circuitId == CIRCUIT.circuitId) {
            logger.log("Destroy received on own circuit socket %d", socketId);
            event.emit('restart');
        } else
            cell.destroy(socketId, circuitId);
    }

    function get() {
        let circuit = {
            circuitId: CIRCUIT.circuitId,
            socketId: CIRCUIT.socketId
        };
        return circuit;
    }

    function print() {
        let circuit = CIRCUIT.routers.map(function(router) {
            return router.agent + " - " + router.ip + ":" + tools.padToLength(router.port, 5);
        });
        logger.out("Our Circuit (%d, %d):\n%s", CIRCUIT.socketId, CIRCUIT.circuitId, tools.objectString(circuit));
    }

    function shutdown() {
        CIRCUIT.socketId = null;
        CIRCUIT.circuitId = null;
        CIRCUIT.routers = [];

        ROUTERS.length = 0;
        CREATED.clear();
        PUBLIC_KEYS.clear();
    }

    function notify(socketId, circuitId) {
        if (CIRCUIT.socketId === socketId && CIRCUIT.circuitId === circuitId) {
            logger.log("Own circuit has closed", socketId, circuitId);
            event.emit('restart');
        }
    }

    function circuitCreate(socketId, callback) {
        let agent = conn.getAgent(socketId);

        if (PUBLIC_KEYS.has(agent))
            helper(callback);
        else
            reg.key(agent, function(err, publicKey) {
                if (err)
                    return callback(err);

                layers.addPublicKey(agent, publicKey);
                PUBLIC_KEYS.add(agent);

                helper(callback);
            });

        function helper(callback) {
            CREATED.add(socketId);
            callback(null);
        }
    }

})();

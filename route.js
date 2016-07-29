;(function() {
    "use strict";

    Object.freeze(module.exports = Object.create(exports));

    require('./cake.js');

    exports.get = getRoute;
    exports.set = setRoute;
    exports.delete = deleteRoute;
    exports.closed = closedRoute;
    exports.print = printRoutingTable;
    exports.shutdown = shutdownRoute;

    const RTABLE = {};

    // get the destination in the routing table for a particular source
    function getRoute(socket_id, circuit_id) {
        let src = {
            socket_id: socket_id,
            circuit_id: circuit_id
        };
        return RTABLE[JSON.stringify(src)];
    }

    // set the destination in the routing table for a particular source
    function setRoute(src_socket_id, src_circuit_id, dst_socket_id, dst_circuit_id) {
        let src = {
            socket_id: src_socket_id,
            circuit_id: src_circuit_id
        };
        let dst = {
            socket_id: dst_socket_id,
            circuit_id: dst_circuit_id
        };
        RTABLE[JSON.stringify(src)] = dst;
        RTABLE[JSON.stringify(dst)] = src;
    }

    function deleteRoute(src_socket_id, src_circuit_id, dst_socket_id, dst_circuit_id) {
        let src = {
            socket_id: src_socket_id,
            circuit_id: src_circuit_id
        };
        let dst = {
            socket_id: dst_socket_id,
            circuit_id: dst_circuit_id
        };
        delete RTABLE[JSON.stringify(src)];
        delete RTABLE[JSON.stringify(dst)];
    }

    function closedRoute(socket_id) {
        Object.getOwnPropertyNames(RTABLE).forEach(function iterator(key) {
            let src = JSON.parse(key);
            let dst = RTABLE[key];
            if (src.socket == socket_id)
                delete RTABLE[key];
            else if (dst.socket == socket_id)
                delete RTABLE[key];
        });
    }

    function printRoutingTable() {
        let routes = [];
        Object.getOwnPropertyNames(RTABLE).forEach(function iterator(key) {
            let object = JSON.parse(key);
            let value = RTABLE[key];
            let src = "(" + object.socket_id + ", " + object.circuit_id + ")";
            let dst = "(" + value.socket_id + ", " + value.circuit_id + ")";
            routes.push(src + " -> " + dst);
        });
        logger.out("RoutingTable:\n%s", JSON.stringify(routes, null, 4));
    }

    function shutdownRoute() {
        Object.getOwnPropertyNames(RTABLE).forEach(function iterator(route) {
            delete RTABLE[route];
        });
    }
})();

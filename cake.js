;(function() {
    "use strict";

    Object.freeze(module.exports = exports = undefined);

    // load modules from same folder as main instead of */node_modules/
    let load = (function() {
        const PATH = __dirname + '/';
        return function(module) {
            return require(PATH + module);
        };
    })();

    // must be loaded in an order that satisfies dependencies (e.g. consts
    // depends on existence of tools, etc.)
    load('strict');
    global.logger = load('logger');     // main, cell, cert, circuit, conn, consts, layers, reg, event, layers, proxy, reg, route
    global.tools = load('tools');       // cell, cert, circuit, conn, consts, layers, reg
    global.consts = load('consts');     // main cell, cert, conn, pem, ports, proxy, reg, stream, tools
    global.event = load('event');       // main, cert, circuit, reg
    global.ports = load('ports');       // main
    global.route = load('route');       // main, cell, conn
    global.pem = load('pem');           // cert
    global.cert = load('cert');         // main, conn
    global.reg = load('reg');           // main, circuit
    global.proxy = load('proxy');       // main, cell
    global.cell = load('cell');         // main, circuit, conn, stream
    global.circuit = load('circuit');   // main, proxy, conn, cell
    global.conn = load('conn');         // main, circuit, cell
    global.stream = load('stream');     // main, proxy, stream
    global.layers = load('layers');     // main, circuit, conn

    Object.freeze(global);

    if (!Array.prototype.contains)
        Object.defineProperty(Array.prototype, 'contains', {
            writable: false,
            value: function contains(element) {
                return Array.indexOf(element) !== -1;
            }
        });

    if (!String.prototype.contains)
        Object.defineProperty(String.prototype, 'contains', {
            writable: false,
            value: function contains(string, start) {
                return this.indexOf(string, start) !== -1;
            }
        });

    if (!String.prototype.format)
        Object.defineProperty(String.prototype, 'format',  {
            writable: false,
            value: function format() {
                let args = arguments;
                return this.replace(/{(\d+)}/g, function(match, number) {
                    return typeof args[number] != 'undefined' ? args[number] : match;
                });
            }
        });

    if (!Object.reset)
        Object.defineProperty(Object, 'reset', {
            writable: false,
            value: function reset(object) {
                Object.getOwnPropertyNames(object).forEach(function iterator(key) {
                    delete object[key];
                });
            }
        });

    if (!Object.extend)
        Object.defineProperty(Object, 'extend', {
            writable: false,
            value: function extend(origin, add) {
                if (!add || typeof add !== 'object')
                    return origin;

                var keys = Object.keys(add);
                var i = keys.length;
                while (i--)
                    origin[keys[i]] = add[keys[i]];

                return origin;
            }
        });
})();

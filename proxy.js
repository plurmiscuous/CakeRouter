;(function() {
    "use strict";

    Object.freeze(module.exports = Object.create(exports));

    require('./cake.js');

    exports.startup = startup;
    exports.shutdown = shutdown;
    exports.close = close;
    exports.data = handle_stream_data;
    exports.connect = connect_to_server;

    const dns = require('dns');
    const net = require('net');

    let _proxy_server = null;
    let _proxy_port = null;

    let _outgoing_socket_id = null;
    let _outgoing_circuit_id = null;

    // The maximum length of time a connection can be inactive for before being cleaned up
    const MAX_INACTIVE_TIME = 5000;

    // Tracks which client connections are tunnels
    const TUNNELS = {};
    // flags for whether the server's already sent us the HTTP header
    const HEADER_SENT_TO_SERVER = new Set();
    // we store the headers from each server socket here, so if we get sent
    // the HTTP header across multiple packets, we can put them together
    const PARTIAL_SERVER_HEADERS = {};
    // flags for whether the server's already sent us the HTTP header
    const HEADER_SENT_TO_CLIENT = new Set();
    // we store the headers from each server socket here, so if we get sent
    // the HTTP header across multiple packets, we can put them together
    const PARTIAL_CLIENT_HEADERS = {};

    // Maps stream ids to client connection ids
    const CLIENT_CONNECTION_IDS = {};
    // Maps client connection ids to streams
    const CLIENT_STREAMS = {};
    // Maps client connection ids to client connections
    const CLIENT_CONNECTIONS = {};

    // Maps stream ids to client connection ids
    const SERVER_CONNECTION_IDS = {};
    // Maps client connection ids to streams
    const SERVER_STREAMS = {};
    // Maps client connection ids to client connections
    const SERVER_CONNECTIONS = {};

    // Initializes resources for the proxy
    function startup(proxy_port) {
        _proxy_port = proxy_port;

        let info = circuit.get();
        _outgoing_socket_id = info.socketId;
        _outgoing_circuit_id = info.circuitId;

        // listen for incoming requests from the browser
        _proxy_server = net.createServer(function (socket) {
            let client_id = hash_socket(socket);

            socket.setTimeout(MAX_INACTIVE_TIME);

            logger.log('proxy connection from %s:%d', socket.remoteAddress, socket.remotePort);

            socket.on('data', function(data) {
                parse_request(data, this);
            }).on('close', function() {
                end_connection(client_id);
            }).on('end', function() {
                end_connection(client_id);
            }).on('timout', function() {
                socket.end();
            }).on('error', function() {
                end_connection(client_id);
            });
        }).on('error', function() {
        }).on('listening', function() {
             logger.log('Proxy listening on %s:%s', consts.LOCAL_IP, _proxy_port);
        }).listen(_proxy_port, consts.LOCAL_IP);
    }

    // Initializes resources for the proxy
    function shutdown() {
        _proxy_port = undefined;

        _outgoing_socket_id = undefined;
        _outgoing_circuit_id = undefined;

        if (_proxy_server)
            _proxy_server.close();
        _proxy_server = undefined;

        Object.getOwnPropertyNames(CLIENT_CONNECTIONS).forEach(function iterator(key) {
            CLIENT_CONNECTIONS[key].end();
        });
        Object.getOwnPropertyNames(SERVER_CONNECTIONS).forEach(function iterator(key) {
            SERVER_CONNECTIONS[key].end();
        });

        [   TUNNELS, HEADER_SENT_TO_SERVER, PARTIAL_SERVER_HEADERS,
            HEADER_SENT_TO_CLIENT, PARTIAL_CLIENT_HEADERS, CLIENT_CONNECTION_IDS,
            CLIENT_STREAMS, CLIENT_CONNECTIONS, SERVER_CONNECTION_IDS,
            SERVER_STREAMS, SERVER_CONNECTIONS
        ].forEach(function iterator(object) {
            Object.reset(object);
        });
    }

    function parse_request(data, client_socket) {
        let client_id = hash_socket(client_socket);

        if (HEADER_SENT_TO_SERVER.has(client_id) || client_id in TUNNELS) {
            send_on_stream(client_id, data);
            return;
        }

        let dataString = data.toString();

        // if the header is incomplete, store what we have and return
        if (!(dataString.match(/[\r]?\n[\r]?\n/))) {
            if (!PARTIAL_SERVER_HEADERS[client_id])
                PARTIAL_SERVER_HEADERS[client_id] = dataString;
            else
                PARTIAL_SERVER_HEADERS[client_id] += dataString;
            return;
        }

        let payload_position = dataString.search(/[\r]?\n[\r]?\n/);

        // otherwise, pull the first parts from our buffer and
        // add it to what we just got
        if (PARTIAL_SERVER_HEADERS[client_id])
            dataString = PARTIAL_SERVER_HEADERS[client_id] + dataString;

        let header_end_position = dataString.search(/[\r]?\n[\r]?\n/);

        // we split on either /r/n or /n because we must be tolerant of both
        // CRLF and LF line endings
        let headerLines = dataString.substring(0, header_end_position).split(/[\r]?\n/);

        // one more split here to drop the HTTP/1.1 token from the output
        let headerPieces = headerLines[0].split(" ");

        let host = null;
        let port = null;
        for (let i = 0, length = headerLines.length; i < length; i++) {
            let line = headerLines[i].trim();

            if (line.contains("onnection: keep-alive")) {
                headerLines[i] = line.replace("keep-alive", "close");
                continue;
            }

            let words = line.split(" ");
            if (words[0].trim().toLowerCase() !== "host:")
                continue;

            let hostname = words[1].trim().split(":");
            host = hostname[0];

            if (hostname.length === 2) {
                port = hostname[1];
                continue;
            }

            headerPieces[1] = headerPieces[1].trim();
            port = headerPieces[1].match(/:[\d]{1,5}$/);
            if (port)
                port = port[0].substring(1);
            else
                port = headerPieces[1].split(":")[0].toLowerCase() === "https" ? 443 : 80;
        }

        if (!host)
            return;

        let idx = headerPieces[1].lastIndexOf('?');
        if (idx !== -1)
            logger.log("%s %s", headerPieces[0], headerPieces[1].substring(0, idx));
        else
            logger.log("%s %s", headerPieces[0], headerPieces[1]);

        headerLines[0] = [headerPieces[0], headerPieces[1], "HTTP/1.0"].join(" ");

        dns.resolve4(host, function(err, addresses) {
            if (!err)
                host = addresses[0];
            let is_tunnel = headerPieces[0].trim() === "CONNECT";
            connect(port, host, client_socket, is_tunnel, function() {
                let header = headerLines.join("\r\n");
                if (!is_tunnel) {
                    let payload = data.slice(payload_position);
                    send_on_stream(client_id, Buffer.concat([new Buffer(header), payload]));
                    HEADER_SENT_TO_SERVER.add(client_id);
                    delete PARTIAL_SERVER_HEADERS[client_id];
                }
            });
        });
    }

    function connect(port, address, client_socket, is_tunnel, callback) {
        let client_id = hash_socket(client_socket);
        stream.begin(_outgoing_socket_id, _outgoing_circuit_id, address, port, function(success, stream_id) {
            if (!success) {
                logger.log('BeginFailed');
                if (is_tunnel)
                    client_socket.write("HTTP/1.1 502 Bad Gateway\r\n\r\n");
                end_connection(client_id);
            } else {
                logger.log('Connected');

                if (is_tunnel) {
                    client_socket.write("HTTP/1.1 200 Connection Established\r\n\r\n");
                    TUNNELS[client_id] = true;
                }

                let stream_identifier = [_outgoing_socket_id, _outgoing_circuit_id, stream_id];
                CLIENT_CONNECTIONS[client_id] = client_socket;
                CLIENT_STREAMS[client_id] = stream_identifier;
                CLIENT_CONNECTION_IDS[stream_identifier] = client_id;

                callback();
            }
        });
    }

    function connect_to_server(socket_id, circuit_id, stream_id, server_addr, server_port) {
        dns.resolve4(server_addr, function(err, addresses) {
            if (!err)
                server_addr = addresses[0];

            let socket = new net.Socket();
            let server_id = null;
            socket.on('connect', function() {
                logger.log("Begin");

                socket.setTimeout(MAX_INACTIVE_TIME);

                server_id = hash_socket(this);

                let stream_identifier = [socket_id, circuit_id, stream_id];
                SERVER_CONNECTION_IDS[stream_identifier] = server_id;
                SERVER_STREAMS[server_id] = stream_identifier;
                SERVER_CONNECTIONS[server_id] = socket;
                stream.connected(socket_id, circuit_id, stream_id);
            }).on('data', function(data) {
                stream.send(socket_id, circuit_id, stream_id, data);
            }).on('close', function() {
                end_connection(server_id);
            }).on('end', function() {
                end_connection(server_id);
            }).on('timeout', function() {
                end_connection(server_id);
            }).on('error', function() {
                if (server_id)
                    end_connection(server_id);
            });

            try {
                socket.connect(server_port, server_addr);
            } catch (e) {
                console.log('%s: %s', e.name, e.message);
                stream.begin_failed(socket_id, circuit_id, stream_id);
            }
        });
    }

    function send_on_stream(client_id, data) {
        if (!(client_id in CLIENT_STREAMS))
            return false;

        let stream_ids = CLIENT_STREAMS[client_id];
        stream.send(stream_ids[0], stream_ids[1], stream_ids[2], data);

        return true;
    }

    function handle_stream_data(socket_id, circuit_id, stream_id, data) {
        let stream_identifier = [socket_id, circuit_id, stream_id];

        if (stream_identifier in CLIENT_CONNECTION_IDS) {
            let client_id = CLIENT_CONNECTION_IDS[stream_identifier];
            if (!(client_id in CLIENT_CONNECTIONS))
                return;

            let client_socket = CLIENT_CONNECTIONS[client_id];
            parse_response(data, stream_id, client_socket);

        } else if (stream_identifier in SERVER_CONNECTION_IDS) {
            let server_id = SERVER_CONNECTION_IDS[stream_identifier];
            if (!(server_id in SERVER_CONNECTIONS))
                return;

            let server_socket = SERVER_CONNECTIONS[server_id];
            server_socket.write(data);
        }
    }

    function close(socket_id, circuit_id, stream_id) {
        let stream_identifier = [socket_id, circuit_id, stream_id];
        let stream_to_host;

        if (stream_identifier in CLIENT_CONNECTION_IDS)
            stream_to_host = CLIENT_CONNECTION_IDS;
        else if (stream_identifier in SERVER_CONNECTION_IDS)
            stream_to_host = SERVER_CONNECTION_IDS;
        else
            return;

        let host_id = stream_to_host[stream_identifier];
        end_connection(host_id);
    }

    function end_connection(host_id) {
        let host_connection = null;
        let stream_ids = null;
        if (host_id in CLIENT_CONNECTIONS) {
            host_connection = CLIENT_CONNECTIONS[host_id];
            stream_ids = CLIENT_STREAMS[host_id];

            delete CLIENT_CONNECTION_IDS[CLIENT_STREAMS[host_id]];
            delete CLIENT_STREAMS[host_id];
            delete CLIENT_CONNECTIONS[host_id];
            delete PARTIAL_SERVER_HEADERS[host_id];
            HEADER_SENT_TO_SERVER.delete(host_id);

        } else if (host_id in SERVER_CONNECTIONS) {
            host_connection = SERVER_CONNECTIONS[host_id];
            stream_ids = SERVER_STREAMS[host_id];

            delete SERVER_CONNECTION_IDS[SERVER_STREAMS[host_id]];
            delete SERVER_STREAMS[host_id];
            delete SERVER_CONNECTIONS[host_id];
            delete PARTIAL_CLIENT_HEADERS[host_id];
            HEADER_SENT_TO_CLIENT.delete(host_id);
        } else
            return;

        logger.log("End");

        if (host_connection)
            host_connection.destroy();

        if (stream_ids)
            stream.end(stream_ids[0], stream_ids[1], stream_ids[2]);
    }

    function parse_response(data, stream_id, socket) {
        let client_id = hash_socket(socket);

        if (HEADER_SENT_TO_CLIENT.has(client_id) || client_id in TUNNELS) {
            socket.write(data);
            return;
        }

        let dataString = data.toString();

        // if the header is incomplete, store what we have and return
        if (!(dataString.match(/[\r]?\n[\r]?\n/))) {
            if (client_id in PARTIAL_CLIENT_HEADERS)
                PARTIAL_CLIENT_HEADERS[client_id] += dataString;
            else
                PARTIAL_CLIENT_HEADERS[client_id] = dataString;
            return;
        }

        let payload_position = dataString.search(/[\r]?\n[\r]?\n/);

        // otherwise, pull the first parts from our buffer and
        // add it to what we just got
        if (client_id in PARTIAL_CLIENT_HEADERS) {
            dataString = PARTIAL_CLIENT_HEADERS[client_id] + dataString;
            delete PARTIAL_CLIENT_HEADERS[client_id];
        }

        HEADER_SENT_TO_CLIENT.add(client_id);

        let header_end_position = dataString.search(/[\r]?\n[\r]?\n/);

        // replace if necessary in the header only
        let header = dataString.substring(0, header_end_position);
        header = header.replace(/onnection: keep-alive/i, "onnection: close");
        header = header.replace(/HTTP\/1\.1/i, "HTTP/1.0");

        let payload = data.slice(payload_position, data.length);

        socket.write(Buffer.concat([new Buffer(header), payload]));
    }

    function hash_socket(socket) {
        let address = socket.address();
        if (!socket.localPort)
            return address.address + ':' + address.port + '/' + socket.remoteAddress + ':' + socket.remotePort;
        return socket.localAddress + ':' + socket.localPort + '/' + socket.remoteAddress + ':' + socket.remotePort;
    }
})();

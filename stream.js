;(function() {
    "use strict";

    Object.freeze(module.exports = Object.create(exports));

    require('./cake.js');

    exports.startup = function() {};
    exports.shutdown = shutdown;
    exports.begin = make_stream;
    exports.send = send_data;
    exports.end = end_stream;
    exports.connected = connected;
    exports.hash = hash_stream;
    exports.begin_failed = begin_failed;

    const OPENED = new Set();

    const NEXT_IDS = {};

    // Initializes resources for the proxy
    function shutdown() {
        Object.reset(OPENED);
        Object.reset(NEXT_IDS);
    }

    // Creates a stream on the specified circuit to the specified host.
    // Callback should accept a sucess boolean and, if the begin was successful,
    // the stream number of the new stream.
    function make_stream(socket_id, circuit_id, host_ip, host_port, callback) {
        let circuit_identifier = [socket_id, circuit_id];

        if (!NEXT_IDS.hasOwnProperty(circuit_identifier))
            NEXT_IDS[circuit_identifier] = 0;

        let stream_id = NEXT_IDS[circuit_identifier];
        if (stream_id === ((1 << 16) >>> 0))
            NEXT_IDS[circuit_identifier] = 0;
        else
            NEXT_IDS[circuit_identifier]++;

        let stream_identifier = hash_stream(socket_id, circuit_id, stream_id);

        cell.begin(socket_id, circuit_id, stream_id, host_ip, host_port, function(err) {
            if (err) {
                console.log('%s: %s', err.name, err.message)
                return callback(false, null);
            }

            OPENED.add(stream_identifier);
            return callback(true, stream_id);
        });
    }

    // Sends some ammount of data on the specified stream if possible. Will only
    // report true in the callback if the enite message was delivered successfully.
    // message can be any length. Data is an array of binary data.
    function send_data(socket_id, circuit_id, stream_id, data) {
        let stream_identifier = hash_stream(socket_id, circuit_id, stream_id);

        if (!OPENED.has(stream_identifier))
            return;

        for (let i = 0; i < data.length;) {
            let lo = i;
            i = Math.min(i + consts.CELL_SIZE.RelayBody, data.length);
            let body = data.slice(lo, i);

            cell.data(socket_id, circuit_id, stream_id, body);
        }
    }

    // ends the specified stream
    function end_stream(socket_id, circuit_id, stream_id) {
        let stream_identifier = hash_stream(socket_id, circuit_id, stream_id);
        if (OPENED.has(stream_identifier))
            OPENED.delete(stream_identifier);

        cell.end(socket_id, circuit_id, stream_id);
    }

    // ends the specified stream
    function begin_failed(socket_id, circuit_id, stream_id) {
        cell.begin_failed(socket_id, circuit_id, stream_id);
    }

    function connected(socket_id, circuit_id, stream_id) {
        let stream_identifier = hash_stream(socket_id, circuit_id, stream_id);

        OPENED.add(stream_identifier);
        cell.connected(socket_id, circuit_id, stream_id);
    }

    function hash_stream(socket_id, circuit_id, stream_id) {
        return JSON.stringify([socket_id, circuit_id, stream_id]);
    }
})();

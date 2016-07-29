;(function() {
    "use strict";

    Object.freeze(module.exports = Object.create(exports));

    require('./cake.js');

    exports.startup = startup;
    exports.create = create;
    exports.extend = extend;
    exports.destroy = destroy;
    exports.begin = begin;
    exports.data = data;
    exports.end = end;
    exports.connected = connected;
    exports.begin_failed = begin_failed;
    exports.handleCell = handleCell;
    exports.shutdown = shutdown;

    const assert = require('assert');

    // store timers for responses
    // for Open cells:   key := [opener_aid, openee_aid]
    // for Create cells: key := [socket_id, circuit_id]
    // for Relay cells:  key := [socket_id, circuit_id, stream_id]
    const TIMERS = Object.create(null);

    // we can store callbacks here uder the key used to store the timer
    const CALLBACKS = Object.create(null);

    // // TODO: design this so that cells can be parsed/created by supplying the
    // // buffer with a template object to a standard function; this could also be
    // // used for reg and cert communications
    // const LAYOUTS = {
    //     common:                          [consts.CELL_SIZE.CircuitId, consts.CELL_SIZE.CellType],
    //     [consts.CELL_CMD.Create]:       [/* Keys? */],
    //     [consts.CELL_CMD.Created]:      [/* Keys? */],
    //     [consts.CELL_CMD.CreateFailed]: [],
    //     [consts.CELL_CMD.Destroy]:      [],
    //     [consts.CELL_CMD.Relay]:        [consts.CELL_SIZE.StreamId, consts.CELL_SIZE.Digest, consts.CELL_SIZE.BodyLength, consts.CELL_SIZE.RelayCmd],

    // };
    // function parse(buffer, layout) {
    //     let items = [];
    //     let offset = {};
    //     layout.forEach(function iterator(item) {
    //         items.push(tools.bufferRead(buffer, offset, item));
    //     });
    //     return items;
    // }

    // let items = parse(buffer, LAYOUTS[consts.CELL_CMD.RELAY]);

    function parseCell(socket_id, cell) {
        if (cell.length != consts.CELL_SIZE.Cell)
            return;

        let offset = Object.create(null);

        let magic_no = tools.bufferRead(cell, offset, consts.CELL_SIZE.MagicNo);
        if (magic_no != consts.MAGIC_NO)
            return;

        let circuit_id = tools.bufferRead(cell, offset, consts.CELL_SIZE.CircuitId);
        let cell_type = tools.bufferRead(cell, offset, consts.CELL_SIZE.CellType);

        switch (cell_type) {
            case consts.CELL_CMD.Create:
                return handleCreate(socket_id, circuit_id);
            case consts.CELL_CMD.Created:
                return handleCreated(socket_id, circuit_id);
            case consts.CELL_CMD.CreateFailed:
                return handleCreateFailed(socket_id, circuit_id);
            case consts.CELL_CMD.Destroy:
                return handleDestroy(socket_id, circuit_id);
            case consts.CELL_CMD.Relay: {
                let stream_id = tools.bufferRead(cell, offset, consts.CELL_SIZE.StreamId);
                let digest = tools.bufferRead(cell, offset, consts.CELL_SIZE.Digest);
                let body_length = tools.bufferRead(cell, offset, consts.CELL_SIZE.BodyLength);
                let relay_cmd = tools.bufferRead(cell, offset, consts.CELL_SIZE.RelayCmd);
                let body = tools.bufferSlice(cell, offset, body_length);

                return handleRelay(socket_id, circuit_id, stream_id, body, relay_cmd);
            }
            default:
                return;
        }
    }

    function handleCreate(socketId, circuitId) {
        logger.log("RECV: Create (%d,%d)", socketId, circuitId);

        circuit.circuitCreate(socketId, function(err) {
            if (err)
                return sendCreateCell(socketId, consts.CELL_CMD.CreateFailed, circuitId);;

            conn.link_circuit(socketId, circuitId);

            sendCreateCell(socketId, consts.CELL_CMD.Created, circuitId);
        });
    }

    function handleCreated(socket_id, circuit_id) {
        logger.log("RECV: Created (%d,%d)", socket_id, circuit_id);

        let key = [socket_id, circuit_id];
        if (!(key in TIMERS))
            return;

        clearTimer(TIMERS[key]);

        let callback = CALLBACKS[key];
        delete CALLBACKS[key];

        if (callback)
            callback(null);
    }

    function handleCreateFailed(socket_id, circuit_id) {
        logger.log("RECV: CreateFailed (%d,%d)", socket_id, circuit_id);

        let key = [socket_id, circuit_id];
        if (!(key in TIMERS))
            return;

        clearTimer(TIMERS[key]);

        let callback = CALLBACKS[key];
        delete CALLBACKS[key];

        if (callback)
            callback(new Error('CreateFailed'));
    }

    function handleDestroy(socket_id, circuit_id) {
        logger.log("RECV: Destroy (%d,%d)", socket_id, circuit_id);

        circuit.notify(socket_id, circuit_id);

        let dest = route.get(socket_id, circuit_id);
        if (dest) {
            circuit.destroy(dest.socket_id, dest.circuit_id);
            route.delete(dest.socket_id, dest.circuit_id, socket_id, circuit_id);
            sendCreateCell(dest.socket_id, consts.CELL_CMD.Destroy, dest.circuit_id);
        }
        conn.unlink_circuit(socket_id, circuit_id);

    }

    function handleRelay(socket_id, circuit_id, stream_id, body, relay_cmd) {
        let dest = route.get(socket_id, circuit_id);
        if (dest) {
            // this get is just to ensure that the socket exists before writing to it
            let _body = Buffer.concat([body, new Buffer(consts.CELL_SIZE.RelayBody - body.length)]);
            sendRelayCell(dest.socket_id, relay_cmd, dest.circuit_id, stream_id, consts.DIGEST, body.length, _body, true);
            return;
        }

        switch (relay_cmd) {
            case consts.RELAY_CMD.Begin:
                handleBegin(socket_id, circuit_id, stream_id, body);
                return;
            case consts.RELAY_CMD.Data:
                handleData(socket_id, circuit_id, stream_id, body);
                return;
            case consts.RELAY_CMD.End:
                handleEnd(socket_id, circuit_id, stream_id);
                return;
            case consts.RELAY_CMD.Connected:
                handleConnected(socket_id, circuit_id, stream_id);
                return;
            case consts.RELAY_CMD.Extend:
                handleExtend(socket_id, circuit_id, body);
                return;
            case consts.RELAY_CMD.Extended:
                handleExtended(socket_id, circuit_id);
                return;
            case consts.RELAY_CMD.BeginFailed:
                handleBeginFailed(socket_id, circuit_id, stream_id);
                return;
            case consts.RELAY_CMD.ExtendFailed:
                handleExtendFailed(socket_id, circuit_id);
                return;
            default:
                return;
        }
    }

    function handleBegin(socket_id, circuit_id, stream_id, body) {
        logger.log("RECV: Begin (%d,%d,%d)", socket_id, circuit_id, stream_id);

        body = body.toString('UTF-8').split(':');
        let addr = body[0];
        let port = parseInt(body[1]);
        proxy.connect(socket_id, circuit_id, stream_id, addr, port);
    }

    function handleData(socket_id, circuit_id, stream_id, body) {
        logger.log("RECV: Data (%d,%d,%d)", socket_id, circuit_id, stream_id);

        proxy.data(socket_id, circuit_id, stream_id, body);
    }

    function handleEnd(socket_id, circuit_id, stream_id) {
        logger.log("RECV: End (%d,%d,%d)", socket_id, circuit_id, stream_id);

        proxy.close(socket_id, circuit_id, stream_id);
    }

    function handleConnected(socket_id, circuit_id, stream_id) {
        logger.log("RECV: Connected (%d,%d,%d)", socket_id, circuit_id, stream_id);

        let key = [socket_id, circuit_id, stream_id];

        clearTimer(TIMERS[key]);

        let callback = CALLBACKS[key];
        delete CALLBACKS[key];

        if (callback)
            callback(null);
    }

    function handleExtend(socket_id, circuit_id, body) {
        logger.log("RECV: Extend (%d,%d)", socket_id, circuit_id);

        let host = body.toString('UTF-8', 0, body.length - 5).split(':');
        let ip = host[0];
        let port = host[1];
        let agent = body.readUInt32BE(body.length - consts.CELL_SIZE.AgentId);

        circuit.extend_to(ip, port, agent, function(success, ext_socket_id, ext_circuit_id) {
            if (success) {
                route.set(socket_id, circuit_id, ext_socket_id, ext_circuit_id);
                conn.link_circuit(socket_id, circuit_id);
                conn.link_circuit(ext_socket_id, ext_circuit_id);

                sendRelayCell(socket_id, consts.RELAY_CMD.Extended, circuit_id, 0, consts.DIGEST, body.length, body);
            } else
                sendRelayCell(socket_id, consts.RELAY_CMD.ExtendFailed, circuit_id, 0, consts.DIGEST, 0);
        });
    }

    function handleExtended(socket_id, circuit_id) {
        logger.log("RECV: Extended (%d,%d)", socket_id, circuit_id);

        let key = [socket_id, circuit_id];
        if (!(key in TIMERS))
            return;

        clearTimer(TIMERS[key]);

        let callback = CALLBACKS[key];
        delete CALLBACKS[key];

        if (callback)
            callback(null);
    }

    function handleBeginFailed(socket_id, circuit_id, stream_id) {
        logger.log("RECV: BeginFailed (%d,%d,%d)", socket_id, circuit_id, stream_id);

        let key = [socket_id, circuit_id, stream_id];

        clearTimer(TIMERS[key]);

        let callback = CALLBACKS[key];
        delete CALLBACKS[key];

        if (callback)
            callback(new Error('BeginFailed'));
    }

    function handleExtendFailed(socket_id, circuit_id) {
        logger.log("RECV: ExtendFailed (%d,%d)", socket_id, circuit_id);

        let key = [socket_id, circuit_id];
        if (!(key in TIMERS))
            return;

        clearTimer(TIMERS[key]);

        let callback = CALLBACKS[key];
        delete CALLBACKS[key];

        if (callback)
            callback(new Error('ExtendFailed'));
    }

    function sendCreateCell(socket_id, create_type, circuit_id) {
        let cell = new Buffer(consts.CELL_SIZE.Cell);
        let offset = {};

        tools.bufferWrite(cell, offset, consts.MAGIC_NO, consts.CELL_SIZE.MagicNo);
        tools.bufferWrite(cell, offset, circuit_id, consts.CELL_SIZE.CircuitId);

        switch (create_type) {
            case consts.CELL_CMD.Create:
                logger.log("SEND: Create (%d,%d)", socket_id, circuit_id);
                break;
            case consts.CELL_CMD.Created:
                logger.log("SEND: Created (%d,%d)", socket_id, circuit_id);
                break;
            case consts.CELL_CMD.CreateFailed:
                logger.log("SEND: CreateFailed (%d,%d)", socket_id, circuit_id);
                break;
            case consts.CELL_CMD.Destroy:
                logger.log("SEND: Destroy (%d,%d)", socket_id, circuit_id);
                break;
            default:
                return;
        }
        tools.bufferWrite(cell, offset, create_type, consts.CELL_SIZE.CellType);

        if (create_type === consts.CELL_CMD.Create) {
            let key = [socket_id, circuit_id];
            TIMERS[key] = setTimer(key, cell);
        }

        sendCell(socket_id, cell);
    }

    function sendRelayCell(socketId, relayCmd, circuitId, streamId, digest, bodyLength, body, forward) {
        let header = new Buffer(consts.CELL_SIZE.RelayHeader);
        let offset = {};

        tools.bufferWrite(header, offset, consts.MAGIC_NO, consts.CELL_SIZE.MagicNo);
        tools.bufferWrite(header, offset, circuitId, consts.CELL_SIZE.CircuitId);
        tools.bufferWrite(header, offset, consts.CELL_CMD.Relay, consts.CELL_SIZE.CellType);
        tools.bufferWrite(header, offset, streamId, consts.CELL_SIZE.StreamId);
        tools.bufferWrite(header, offset, digest, consts.CELL_SIZE.Digest);
        tools.bufferWrite(header, offset, bodyLength, consts.CELL_SIZE.BodyLength);
        tools.bufferWrite(header, offset, relayCmd, consts.CELL_SIZE.RelayCmd);

        let action = forward ? "FWD" : "SEND";
        switch (relayCmd) {
            case consts.RELAY_CMD.Begin:
                logger.log("%s: Begin (%d,%d,%d)", action, socketId, circuitId, streamId);
                break;
            case consts.RELAY_CMD.Data:
                logger.log("%s: Data (%d,%d,%d)", action, socketId, circuitId, streamId);
                break;
            case consts.RELAY_CMD.End:
                logger.log("%s: End (%d,%d,%d)", action, socketId, circuitId, streamId);
                break;
            case consts.RELAY_CMD.Connected:
                logger.log("%s: Connected (%d,%d,%d)", action, socketId, circuitId, streamId);
                break;
            case consts.RELAY_CMD.Extend:
                logger.log("%s: Extend (%d,%d)", action, socketId, circuitId);
                break;
            case consts.RELAY_CMD.Extended:
                logger.log("%s: Extended (%d,%d)", action, socketId, circuitId);
                break;
            case consts.RELAY_CMD.BeginFailed:
                logger.log("%s: BeginFailed (%d,%d,%d)", action, socketId, circuitId, streamId);
                break;
            case consts.RELAY_CMD.ExtendFailed:
                logger.log("%s: ExtendFailed (%d,%d)", action, socketId, circuitId);
                break;
            default:
                return;
        }


        let cell = null
        switch (relayCmd) {
            case consts.RELAY_CMD.Begin:
            case consts.RELAY_CMD.Data:
            case consts.RELAY_CMD.Extend:
                cell = Buffer.concat([new Buffer(header), body]);
                break;
            default:
                cell = Buffer.concat([new Buffer(header), new Buffer(consts.CELL_SIZE.Cell - consts.CELL_SIZE.RelayHeader)]);

        }
        sendCell(socketId, cell);
    }

    function sendCell(socketId, cell) {
        conn.sendData(socketId, cell);
    }

    function setTimer(key, data) {
        return {
            timerId: setTimeout(function() {
                let timer = TIMERS[key];
                clearTimer(timer);
                handleTimeout(key);
            }, consts.TIMEOUT_INTERVAL),
            data: data,
            timeouts: 0
        };
    }

    function clearTimer(timer) {
        if (timer)
            clearTimeout(timer.timerId);
        delete TIMERS[timer];
    }

    function handleTimeout(key) {
        if (!(key in CALLBACKS))
            return;

        let callback = CALLBACKS[key];
        delete CALLBACKS[key];
        if (callback)
            callback(new Error('Timeout'));
    }

    function startup(callback) {
        if (callback)
            callback();
    }

    function create(circuit_id, ip, port, callback) {
        let socket_id = conn.identify(ip, port);
        let key = [socket_id, circuit_id];
        CALLBACKS[key] = callback;

        sendCreateCell(socket_id, consts.CELL_CMD.Create, circuit_id);
    }

    function extend(circuit_id, src_ip, src_port, dst_ip, dst_port, agent, callback) {
        let socket_id = conn.identify(src_ip, src_port);

        let key = [socket_id, circuit_id];
        CALLBACKS[key] = callback;
        TIMERS[key] = setTimer(key);

        let body = new Buffer(consts.CELL_SIZE.RelayBody);
        let host = dst_ip + ':' + dst_port;
        let offset = {};

        tools.bufferWrite(body, offset, host, host.length);
        tools.bufferWrite(body, offset, 0, 1);
        tools.bufferWrite(body, offset, agent, consts.CELL_SIZE.AgentId);;

        sendRelayCell(socket_id, consts.RELAY_CMD.Extend, circuit_id, 0, consts.DIGEST, offset.position, body);
    }

    function destroy(socket_id, circuit_id) {
        conn.unlink_circuit(socket_id, circuit_id);

        sendCreateCell(socket_id, consts.CELL_CMD.Destroy, circuit_id);
    }

    function begin(socket_id, circuit_id, stream_id, dst_ip, dst_port, callback) {
        let key = [socket_id, circuit_id, stream_id];
        CALLBACKS[key] = callback;
        TIMERS[key] = setTimer(key);

        let body = new Buffer(consts.CELL_SIZE.RelayBody);
        let host = dst_ip + ':' + dst_port;
        let offset = {};

        tools.bufferWrite(body, offset, host, host.length);
        tools.bufferWrite(body, offset, 0, 1);

        sendRelayCell(socket_id, consts.RELAY_CMD.Begin, circuit_id, stream_id, consts.DIGEST, offset.position, body);
    }

    function data(socket_id, circuit_id, stream_id, data) {
        let body = new Buffer(consts.CELL_SIZE.RelayBody);
        let body_length = consts.CELL_SIZE.RelayBody < data.length ? consts.CELL_SIZE.RelayBody : data.length;
        if (Buffer.isBuffer(data))
            data.copy(body, 0, 0, body_length);
        else
            body.write(data, 0, body_length, 'UTF-8');

        sendRelayCell(socket_id, consts.RELAY_CMD.Data, circuit_id, stream_id, consts.DIGEST, body_length, body);
    }

    function end(socket_id, circuit_id, stream_id) {
        let body = new Buffer(consts.CELL_SIZE.RelayBody);
        let offset = 0;

        sendRelayCell(socket_id, consts.RELAY_CMD.End, circuit_id, stream_id, consts.DIGEST, offset, body);
    }

    function connected(socket_id, circuit_id, stream_id) {
        let body = new Buffer(consts.CELL_SIZE.RelayBody);
        let offset = 0;

        sendRelayCell(socket_id, consts.RELAY_CMD.Connected, circuit_id, stream_id, consts.DIGEST, offset, body);
    }

    function begin_failed(socket_id, circuit_id, stream_id) {
        let body = new Buffer(consts.CELL_SIZE.RelayBody);
        let offset = 0;

        sendRelayCell(socket_id, consts.RELAY_CMD.BeginFailed, circuit_id, stream_id, consts.DIGEST, offset, body);
    }

    function handleCell(socket_id, cell) {
        parseCell(socket_id, cell);
    }

    function shutdown() {
        Object.getOwnPropertyNames(TIMERS).forEach(function iterator(key) {
            clearTimeout(TIMERS[key]);
        });
        Object.reset(TIMERS);
        Object.reset(CALLBACKS);
    }
})();

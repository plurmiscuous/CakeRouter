// Cake Registration Agent
//
// Example usage below. Note that the callback for fetch
// requires a parameter.
//
// const reg = require('./reg.js');
//
// reg.init(host, port, callback() {});
// reg.register(port, data, function() {});
// reg.fetch(prefix, function(response) {});
// reg.unregister(port, function() {});
//
// for fetch, the response return value is an array of the following:
//      { ip: 'aaa.bbb.ccc.ddd', port: NNNNN, data: NNNNNNNN }
;(function() {
    "use strict";

    Object.freeze(module.exports = Object.create(exports));

    require('./cake.js');

    exports.init = init;
    exports.register = register;
    exports.fetch = fetch;
    exports.key = key;
    exports.shutdown = shutdownReg;

    const dns = require('dns');
    const net = require('net');
    const tls = require('tls');

    const PACKETS = {};
    const PENDING = {};
    const CALLBACKS = {};
    const REREG_TIMERS = {};

    let _local_ip = null;
    let _reg_host = null;
    let _reg_port = null;
    let _reg_ip = null;

    let _service_port = null;
    let _cred = null;
    let _socket = null;

    // generates a new sequence number
    const sequence = (function() {
        let _sequence_no = 0;
        return function() {
            if (_sequence_no == ((1 << 8) >>> 0))
                _sequence_no = 0;
            return _sequence_no++;
        };
    })();

    // sends a Register
    function sendRegister(port, callback) {
        let payload = new Buffer(consts.REG_SIZE.Command + consts.REG_SIZE.Port);
        let offset = {};

        tools.bufferWrite(payload, offset, consts.REG_CMD.Register, consts.REG_SIZE.Command);
        tools.bufferWrite(payload, offset, port, consts.REG_SIZE.Port);

        let sequence_no = sequence();
        PENDING[sequence_no] = {
            port: port
        };
        if (callback)
            CALLBACKS[sequence_no] = callback;

        logger.log("Register");
        sendMessage(payload, sequence_no);
    }

    // sends a Fetch
    function sendFetchRequest(callback) {
        let payload = new Buffer(consts.REG_SIZE.Command);
        let offset = {};

        tools.bufferWrite(payload, offset, consts.REG_CMD.FetchRequest, consts.REG_SIZE.Command);

        let sequence_no = sequence();

        if (callback)
            CALLBACKS[sequence_no] = callback;

        logger.log("FetchRequest");
        sendMessage(payload, sequence_no);
    }

    function sendKeyRequest(agentName, callback) {
        let payload = new Buffer(consts.REG_SIZE.Command + consts.REG_SIZE.Agent);
        let offset = {};

        tools.bufferWrite(payload, offset, consts.REG_CMD.KeyRequest, consts.REG_SIZE.Command);
        tools.bufferWrite(payload, offset, agentName, consts.REG_SIZE.Agent);

        let sequence_no = sequence();

        if (callback)
            CALLBACKS[sequence_no] = callback;

        logger.log("KeyRequest");
        sendMessage(payload, sequence_no);
    }

    // sends an Unregister
    function sendUnregister(port, callback) {
        let payload = new Buffer(consts.REG_SIZE.Command + consts.REG_SIZE.Port);
        let offset = {};

        tools.bufferWrite(payload, offset, consts.REG_CMD.Unregister, consts.REG_SIZE.Command);
        tools.bufferWrite(payload, offset, port, consts.REG_SIZE.Port);

        let sequence_no = sequence();

        if (callback)
            CALLBACKS[sequence_no] = callback;

        logger.log("Unregister");
        sendMessage(payload, sequence_no);

        clearTimeout(REREG_TIMERS[port]);
    }

    // does the actual sending of the messages; also saves a copy of
    // the sent packet so it can be resent on timeout
    function sendMessage(message, sequence_no) {
        let header = new Buffer(consts.REG_SIZE.MagicNo + consts.REG_SIZE.SeqNum);
        let offset = {};

        tools.bufferWrite(header, offset, consts.MAGIC_NO, consts.REG_SIZE.MagicNo);
        tools.bufferWrite(header, offset, sequence_no, consts.REG_SIZE.SeqNum);

        let packet = Buffer.concat([header, message]);

        PACKETS[sequence_no] = packet;

        if (_socket)
            _socket.write(packet);
    }

    // handles receiving a Registered from the server
    function handleRegistered(sequence_no, lifetime) {
        logger.log("Registered");

        let info = PENDING[sequence_no];
        delete PENDING[sequence_no];

        REREG_TIMERS[info.port] = setTimeout(function() {
            sendRegister(info.port, info.data);
        }, (lifetime << 9) >>> 0);

        let callback = CALLBACKS[sequence_no];
        delete CALLBACKS[sequence_no];
        if (callback)
            callback(null);
    }

    // handles receiving a FetchResponse from the server
    function handleFetchResponse(sequence_no, nentries, entries) {
        logger.log("FetchResponse");

        let response = [];

        if (nentries === 0)
            logger.log("Empty FetchResponse");

        let offset = {};
        for (let i = 0; i < nentries; ++i) {
            let ip = tools.bufferRead(entries, offset, consts.REG_SIZE.IP);
            let port = tools.bufferRead(entries, offset, consts.REG_SIZE.Port);
            let data = tools.bufferRead(entries, offset, consts.REG_SIZE.Agent);
            response.push({
                ip: tools.convertUInt32toIPv4(ip),
                port: port,
                data: data,
                agent: tools.agentString(data)
            });
        }

        let callback = CALLBACKS[sequence_no];
        delete CALLBACKS[sequence_no];
        if (callback)
            callback(null, response);
    }

    function handleKeyResponse(sequence_no, publicKey) {
        logger.log('KeyResponse');

        let callback = CALLBACKS[sequence_no];
        delete CALLBACKS[sequence_no];
        if (callback)
            callback(null, publicKey.toString());
    }

    // handles receiving a Registered from the server
    function handleUnregistered(sequence_no) {
        logger.log('Unregistered');

        let callback = CALLBACKS[sequence_no];
        delete CALLBACKS[sequence_no];
        if (callback)
            callback();
    }

    function handleError(sequence_no) {
        logger.log('Error');

        let callback = CALLBACKS[sequence_no];
        delete CALLBACKS[sequence_no];
        if (callback)
            callback(new Error('Error'));
    }

    function init(host, port, credentials, callback) {
        _reg_host = host;
        _reg_port = port;
        _cred = credentials;

        if (net.isIPv4(_reg_host)) {
            _reg_ip = _reg_host;
        } else {
            logger.log("Resolving server hostname:");
            dns.resolve4(_reg_host, function (err, addresses) {
                if (err) {
                    logger.log("unable to connect to the network");
                    event.emit('shutdown');
                } else
                    _reg_ip = addresses[0];
            });
        }

        logger.log("+ Server IP %s", _reg_ip);
        _local_ip = tools.convertIPv4toUInt32(consts.LOCAL_IP);

        let options = {
            host: _reg_ip,
            port: _reg_port,
            key: _cred.key,
            cert: _cred.certificate,
            ca: _cred.ca,
            requestCert: true,
            rejectUnauthorized: true
        };

        try {
            _socket = tls.connect(options, function() {
                _socket.on('error', function() {
                    event.emit('restart');
                }).on('data', function(data) {
                    handleData(data);
                });
                callback();
            });
        } catch(e) {
            console.log('Unable to connect to registration server');
            process.exit(-1);
        }
    }

    function handleData(buffer) {
        let offset = {};

        let magic_no = tools.bufferRead(buffer, offset, consts.REG_SIZE.MagicNo);
        if (magic_no != consts.MAGIC_NO)
            return;
        let sequence_no = tools.bufferRead(buffer, offset, consts.REG_SIZE.SeqNum);

        if (!(sequence_no in PACKETS))
            return;
        delete PACKETS[sequence_no];

        let command = tools.bufferRead(buffer, offset, consts.REG_SIZE.Command);
        switch (command) {
            case consts.REG_CMD.Registered:
                let lifetime = tools.bufferRead(buffer, offset, consts.REG_SIZE.Lifetime);

                handleRegistered(sequence_no, lifetime);
                break;
            case consts.REG_CMD.FetchResponse:
                let nentries = tools.bufferRead(buffer, offset, consts.REG_SIZE.NumEntries);
                let entries = tools.bufferSlice(buffer, offset);

                handleFetchResponse(sequence_no, nentries, entries);
                break;
            case consts.REG_CMD.KeyResponse:
                let keyLength = tools.bufferRead(buffer, offset, consts.REG_SIZE.KeyLength);
                let publicKey = tools.bufferSlice(buffer, offset, keyLength);

                handleKeyResponse(sequence_no, publicKey);
                break;
            case consts.REG_CMD.Unregistered:

                handleUnregistered(sequence_no);
                break;
            case consts.REG_CMD.Error:

                handleError(sequence_no);
                break;
            default:
                console.error('Unknown reg command: %d', command);
                throw new Error("unrecognized response from reg_server");
        }
    }

    function register(port, callback) {
        _service_port = port;
        sendRegister(_service_port, callback);
    }

    function fetch(callback) {
        sendFetchRequest(callback);
    }

    function key(agentName, callback) {
        if (typeof agentName === 'string')
            agentName = parseInt(agentName, 16);
        sendKeyRequest(agentName, callback);
    }

    function shutdownReg() {
        if (_service_port) {
            sendUnregister(_service_port, function() {
                _local_ip = _service_port = null;
                _reg_host = _reg_port = _reg_ip = null;
                Object.getOwnPropertyNames(REREG_TIMERS).forEach(function iterator(timer) {
                    clearTimeout(REREG_TIMERS[timer]);
                });
                Object.reset(CALLBACKS);
                Object.reset(PACKETS);
                Object.reset(PENDING);
                Object.reset(REREG_TIMERS);
            });
        }
    }
})();

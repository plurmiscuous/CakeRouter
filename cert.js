;(function() {
    "use strict";

    Object.freeze(module.exports = Object.create(exports = Object.create(null)));

    require('./cake.js');

    exports.init = init;
    exports.credentials = credentials;

    const tls = require('tls');

    const PORT = consts.PORTS.CertServer;
    const HOST = consts.LOCAL_IP;

    let socket = null;

    const PEM = {};
    let CALLBACKS = {};

    let sequence = (function() {
        let _sequence_no = 1;
        return function() {
            if (_sequence_no == ((1 << 8) >>> 0))
                _sequence_no = 1;
            return _sequence_no++;
        };
    })();

    function init(callback) {
        logger.log('Generating Private Key');

        pem.private(function(err, key) {
            if (err)
                return callback(err);

            let options = {
                key: key,
                days: 1,
                CN: 'Cake Agent'
            };

            logger.log('Generating Certificate Signing Request');

            pem.csr(options, function(err, csr) {
                if (err)
                    return callback(err);

                options.csr = csr.csr;
                options.key = csr.key;

                logger.log('Generating Self-Signed Certificate');

                pem.certificate(options, function(err, crt) {
                    if (err)
                        return callback(err);

                    PEM.key = crt.key;
                    PEM.csr = crt.csr;
                    PEM.certificate = crt.certificate;

                    CALLBACKS.main = callback;

                    connect();
                });
            });
        });
    }

    function connect() {
        logger.log('Connecting to Certification Server');

        let options = {
            host: HOST,
            port: PORT,
            key: PEM.key,
            cert: PEM.certificate,
            requestCert: true,
            rejectUnauthorized: false
        };

        socket = tls.connect(options, function() {
            socket.on('error', function() {
                event.emit('restart');
            }).on('data', function(data) {
                handleData(data);
            });

            requestRoot();
        });
    }

    function handleData(data) {
        if (data.length != consts.CERT_SIZE.Packet)
            return;
        let offset = {};

        let cmd = tools.bufferRead(data, offset, consts.CERT_SIZE.Command);
        let sequence_no = tools.bufferRead(data, offset, consts.CERT_SIZE.SeqNum);

        switch (cmd) {
            case consts.CERT_CMD.Root: {
                let agentId = tools.bufferRead(data, offset, consts.CERT_SIZE.AgentId);
                let length = tools.bufferRead(data, offset, consts.CERT_SIZE.Length);
                let ca = tools.bufferSlice(data, offset, length);

                PEM.agentId = agentId.toString(16).toUpperCase();
                PEM.ca = ca.toString();

                return handleRoot(sequence_no);
            }
            case consts.CERT_CMD.Signed: {
                let length = tools.bufferRead(data, offset, consts.CERT_SIZE.Length);
                let certificate = tools.bufferSlice(data, offset, length);

                PEM.certificate = certificate.toString();

                return handleSigned(sequence_no);
            }
            case consts.CERT_CMD.Error:
                return handleError(sequence_no);
            default:
                return;
        }
    }

    function requestRoot() {
        logger.log('Requesting Root CA');

        let sequence_no = sequence();

        let request = new Buffer(consts.CERT_SIZE.Packet);
        let offset = {};

        tools.bufferWrite(request, offset, consts.CERT_CMD.Get, consts.CERT_SIZE.Command);
        tools.bufferWrite(request, offset, sequence_no, consts.CERT_SIZE.SeqNum);

        if (socket)
            socket.write(request);
    }

    function handleRoot(sequence_no) {
        logger.log('Received Root CA');

        requestSigning();
    }

    function requestSigning() {
        if (!PEM.ca)
            return;

        logger.log('Generating Public Key');

        pem.public(PEM.key, function(err, pub) {
            PEM.pub = pub;

            let options = {
                key: PEM.key,
                CN: PEM.agentId
            };

            pem.csr(options, function(err, csr) {
                logger.log('Certificate Signing Request');
                if (err)
                    return callback(new Error('Cert CSR Error'));

                let config = csr.config;

                let sequence_no = sequence();

                let request = new Buffer(consts.CERT_SIZE.Packet);
                let offset = {};

                tools.bufferWrite(request, offset, consts.CERT_CMD.Request, consts.CERT_SIZE.Command);
                tools.bufferWrite(request, offset, sequence_no, consts.CERT_SIZE.SeqNum);
                tools.bufferWrite(request, offset, config ? 1 : 0, consts.CERT_SIZE.HasConfig);
                tools.bufferWrite(request, offset, Buffer.byteLength(csr.csr), consts.CERT_SIZE.Length);
                if (config)
                    tools.bufferWrite(request, offset, Buffer.byteLength(config), consts.CERT_SIZE.Length);
                tools.bufferWrite(request, offset, csr.csr);
                if (config)
                    tools.bufferWrite(request, offset, config);

                if (socket)
                    socket.write(request);
            });
        });
    }

    function handleSigned(sequence_no) {
        socket.destroy();

        if (!PEM.certificate || !PEM.ca)
            return;

        pem.verify(PEM.certificate, PEM.ca, function(err, valid) {
            let callback = CALLBACKS.main;
            delete CALLBACKS.main;

            if (callback) {
                if (err || !valid)
                    callback(new Error('Certificate Signing Error'));
                else {
                    logger.log('Signed Certificate Received');
                    callback(null);
                }
            }
        });
    }

    function handleError(sequence_no) {
        logger.log('Error');

        let callback = CALLBACKS.main;
        delete CALLBACKS.main;

        if (callback)
            callback(new Error('Signing Request Error'));
    }

    function credentials() {
        return {
            key: PEM.key,
            publicKey: PEM.pub,
            certificate: PEM.certificate,
            ca: PEM.ca
        };
    }

})();

;(function() {
    "use strict";

    Object.freeze(module.exports = exports = undefined);

    require('./cake.js');

    const tls = require('tls');
    const crypto = require('crypto');

    const HOST = consts.LOCAL_IP;
    const PORT_CERT = consts.PORTS.CertServer;
    const PORT_REG = consts.PORTS.RegServer;

    const ROOT = {};
    const SERVER = {};

    const IDS = new Set();
    const VALID = new Set();

    const AGENTS = {};
    const CERTIFICATIONS = {};    // hex => {ip, publicKey}
    const REGISTRATIONS = {};
    const TIMERS = {};
    const LIFETIME = 120;

    let certServer = null;
    let regServer = null;

    function generateRootCA() {
        pem.private(function(err, key) {
            if (err)
                throw err;

            ROOT.privateKey = key;

            let options = {
                days: 36500,
                CN:   'Cake Certification Server',
                key:  ROOT.privateKey
            };

            pem.csr(options, function(err, csr) {
                if (err)
                    throw err;

                ROOT.csr = csr.csr;
                if (csr.config)
                    ROOT.config = csr.config;

                let options = {
                    days:        36500,
                    csr:         ROOT.csr,
                    key:         ROOT.privateKey,
                };
                if (ROOT.config)
                    options.config = ROOT.config;

                pem.certificate(options, function(err, crt) {
                    if (err)
                        throw err;

                    ROOT.ca = crt.certificate;
                    generateServerCertificate();
                });
            });
        });
    }

    function generateServerCertificate() {
        pem.private(function(err, key) {
            if (err)
                throw err;

            SERVER.privateKey = key;

            let options = {
                key: SERVER.privateKey,
                days: 1,
                CN: 'Cake Registration Server'
            };

            pem.csr(options, function(err, csr) {
                if (err)
                    throw err;

                SERVER.csr = csr.csr;
                if (csr.config)
                    SERVER.config = csr.config;

                let options = {
                    days:        36500,
                    csr:         SERVER.csr,
                    key:         ROOT.privateKey,
                    certificate: ROOT.ca
                };
                if (SERVER.config)
                    options.config = SERVER.config;

                pem.certificate(options, function(err, crt) {
                    if (err)
                        throw err;

                    SERVER.certificate = crt.certificate;
                    startServers();
                });
            });
        });
    }

    function startServers() {
        let certOptions = {
            key: ROOT.privateKey,
            cert: ROOT.ca,
            requestCert: true,
            rejectUnauthorized: false
        };

        certServer = tls.createServer(certOptions, function(socket) {
            handleCertSocket(socket);
        }).listen(PORT_CERT, HOST, function() {
            logger.out('http://%s:%d Certification Server listening', HOST, PORT_CERT);
        }).on('close', function() {});

        let regOptions = {
            key: SERVER.privateKey,
            cert: SERVER.certificate,
            ca: ROOT.ca,
            requestCert: true,
            rejectUnauthorized: true
        };

        regServer = tls.createServer(regOptions, function(socket) {
            handleRegSocket(socket);
        }).listen(PORT_REG, HOST, function() {
            logger.out('http://%s:%d Registration Server listening', HOST, PORT_REG);
        }).on('close', function() {});
    }

    /// Certification Server Functions

    function handleCertSocket(socket) {
        let certificate = socket.getPeerCertificate();
        if (!certificate || !certificate.subject)
            return socket.destroy();

        let name = certificate.subject.CN;
        switch (name) {
            case 'Cake Agent':
                let agent = AGENTS[socket] = {};
                agent.ip = socket.remoteAddress;

                do
                    agent.id = crypto.randomBytes(4).readUInt32LE(0);
                while (IDS.has(agent.id));
                IDS.add(agent.id);

                agent.hex = tools.agentString(agent.id.toString(16).toUpperCase());

                logger.out('%s:%d New Cake Router %s', socket.remoteAddress, socket.remotePort, agent.hex);
                break;
            default:
                return socket.destroy();
        }

        socket.on('data', function(data) {
            handleCertData(data, socket);
        }).once('close', function() {
            delete AGENTS[socket];
        }).once('error', function(e) {
            logger.out('%s: %s', e.name, e.message);
        });
    }

    function handleCertData(data, socket) {
        if (data.length != consts.CERT_SIZE.Packet)
            return;
        let offset = 0;

        let cmd = data.readUInt8(offset);
        offset += consts.CERT_SIZE.Command;
        let seq = data.readUInt8(offset);
        offset += consts.CERT_SIZE.SeqNum;

        switch (cmd) {
            case consts.CERT_CMD.Get:
                logger.out('%s:%d Root Certificate Authority Request', socket.remoteAddress, socket.remotePort);

                handleCertGet(socket, seq);
                return;
            case consts.CERT_CMD.Request:
                logger.out('%s:%d Certificate Signing Request', socket.remoteAddress, socket.remotePort);

                let hasConfig = data.readUInt8(offset);
                offset += consts.CERT_SIZE.HasConfig;

                let csrLength = data.readUInt16BE(offset);
                offset += consts.CERT_SIZE.Length;
                let configLength = null;
                if (hasConfig) {
                    configLength = data.readUInt16BE(offset);
                    offset += consts.CERT_SIZE.Length;
                }
                let csr = data.slice(offset, offset + csrLength).toString();
                offset += csrLength;
                let config = null;
                if (hasConfig) {
                    config = data.slice(offset, offset + configLength).toString();
                    offset += configLength;
                }

                handleCertCsr(socket, seq, csr, config);
                return;
            default:
                return;
        }
    }

    function handleCertGet(socket, seq) {
        sendCertRoot(socket, seq);
    }


    function handleCertCsr(socket, seq, csr, config) {
        let agent = AGENTS[socket];

        pem.getCertificateInfo(csr, function(err, info) {
            let commonName = tools.agentString(info.commonName);
            if (err || commonName !== AGENTS[socket].hex)
                return sendCertError(socket, seq);

            pem.public(csr, function(err, publicKey) {
                if (err)
                    return sendCertError(socket, seq);

                agent.publicKey = publicKey;

                let options = {
                    days:        365,
                    csr:         csr,
                    key:         ROOT.privateKey,
                    certificate: ROOT.ca,
                };

                if (config)
                    options.config = config;

                pem.certificate(options, function(err, crt) {
                    if (err)
                        return sendCertError(socket, seq);

                    VALID.add(agent.hex);
                    CERTIFICATIONS[agent.hex] = {
                        ip: agent.ip,
                        publicKey: agent.publicKey
                    };
                    sendCertCertificate(socket, seq, crt.certificate);
                });
            });
        });
    }

    function sendCertRoot(socket, seq) {
        if (!socket)
            return;

        let response = new Buffer(consts.CERT_SIZE.Packet);
        let offset = {};

        tools.bufferWrite(response, offset, consts.CERT_CMD.Root, consts.CERT_SIZE.Command);
        tools.bufferWrite(response, offset, seq, consts.CERT_SIZE.SeqNum);
        tools.bufferWrite(response, offset, AGENTS[socket].id, consts.CERT_SIZE.AgentId);
        tools.bufferWrite(response, offset, Buffer.byteLength(ROOT.ca), consts.CERT_SIZE.Length);
        tools.bufferWrite(response, offset, ROOT.ca);

        socket.write(response);
    }

    function sendCertCertificate(socket, seq, certificate) {
        let response = new Buffer(consts.CERT_SIZE.Packet);
        let offset = {};

        tools.bufferWrite(response, offset, consts.CERT_CMD.Signed, consts.CERT_SIZE.Command);
        tools.bufferWrite(response, offset, seq, consts.CERT_SIZE.SeqNum);
        tools.bufferWrite(response, offset, Buffer.byteLength(certificate), consts.CERT_SIZE.Length);
        tools.bufferWrite(response, offset, certificate);

        if (socket)
            socket.write(response);
    }

    function sendCertError(socket, seq) {
        if (!socket)
            return;

        let response = new Buffer(consts.CERT_SIZE.Packet);
        let offset = {};

        tools.bufferWrite(response, offset, consts.CERT_CMD.Error, consts.CERT_SIZE.Command);
        tools.bufferWrite(response, offset, seq, consts.CERT_SIZE.SeqNum);

        if (socket)
            socket.write(response);
    }

    /// Registration Server Functions

    function handleRegSocket(socket) {
        socket.on('data', function(data) {
            handleRegData(data, socket);
        }).once('error', function() {});
    }

    function handleRegData(data, socket) {
        let offset = {};

        let magiceNumber = tools.bufferRead(data, offset, consts.REG_SIZE.MagicNo);
        if (magiceNumber != consts.MAGIC_NO)
            return;

        let sequence_no = tools.bufferRead(data, offset, consts.REG_SIZE.SeqNum);
        let command = tools.bufferRead(data, offset, consts.REG_SIZE.Command);

        switch (command) {
            case consts.REG_CMD.Register: {
                let port = tools.bufferRead(data, offset, consts.REG_SIZE.Port);
                return handleRegister(socket, sequence_no, port);
            }
            case consts.REG_CMD.FetchRequest:
                return handleFetchRequest(socket, sequence_no);
            case consts.REG_CMD.KeyRequest: {
                let agent = tools.bufferRead(data, offset, consts.REG_SIZE.Agent);
                return handleKeyRequest(socket, sequence_no, agent);
            }
            case consts.REG_CMD.Unregister: {
                let port = tools.bufferRead(data, offset, consts.REG_SIZE.Port);
                return handleUnregister(socket, sequence_no, port);
            }
            default:
                return;
        }
    }

    function handleRegister(socket, sequence_no, port) {
        let agentName = tools.agentString(socket.getPeerCertificate().subject.CN);

        logger.out("RECV: %s Register", agentName);

        // if registration is from an invalid name, silently reject
        if (!VALID.has(agentName)) {
            logger.out('INFO: Agent not certified %s', agentName);
            return;
        }

        let info = CERTIFICATIONS[agentName];

        if (REGISTRATIONS.hasOwnProperty(agentName)) {
            REGISTRATIONS[agentName].port = port;
            clearTimeout(TIMERS[agentName]);
        } else {
            REGISTRATIONS[agentName] = {
                ip:   tools.convertIPv4toUInt32(info.ip),
                port: port,
                data: parseInt(agentName, 16),
                agentName: agentName
            };
        }

        TIMERS[agentName] = timer(agentName);

        respondRegistered(socket, sequence_no);
    }

    function handleUnregister(socket, sequence_no, port) {
        let agentName = tools.agentString(socket.getPeerCertificate().subject.CN);

        logger.out("RECV: %s Unregister", agentName);

        if (REGISTRATIONS.hasOwnProperty(agentName)) {
            let registration = REGISTRATIONS[agentName];
            delete REGISTRATIONS[agentName];
            delete TIMERS[agentName];

            if (!registration)
                logger.out('INFO: Agent not registered %s', agentName);

            respondUnregistered(socket, sequence_no, agentName);
        }
    }

    function handleFetchRequest(socket, sequence_no) {
        let agentName = tools.agentString(socket.getPeerCertificate().subject.CN);

        logger.out("RECV: %s FetchRequest", agentName);

        let entries = [];
        Object.getOwnPropertyNames(REGISTRATIONS).forEach(function iterator(agentName) {
            entries.push(REGISTRATIONS[agentName]);
        });

        respondFetchResponse(socket, sequence_no, entries);
    }

    function handleKeyRequest(socket, sequence_no, agent) {
        let agentName = tools.agentString(socket.getPeerCertificate().subject.CN);
        if (!REGISTRATIONS.hasOwnProperty(agentName))
            return;

        logger.out("RECV: %s KeyRequest %s", agentName, agent);

        agent = tools.agentString(agent);
        if (!REGISTRATIONS.hasOwnProperty(agent)) {
            logger.out('INFO: Agent not registered %s', agent);
            return respondRegError(socket, sequence_no);
        }

        let key = CERTIFICATIONS[agent].publicKey;

        respondKeyResponse(socket, sequence_no, key);
    }

    function respondRegistered(socket, sequence_no) {
        let agentName = tools.agentString(socket.getPeerCertificate().subject.CN);

        logger.out("SEND: %s Registered", agentName);

        let packet = new Buffer(consts.REG_SIZE.SeqNum + consts.REG_SIZE.Command + consts.REG_SIZE.Lifetime);
        let offset = 0;

        packet.writeUInt8(sequence_no, offset);
        offset += consts.REG_SIZE.SeqNum;
        packet.writeUInt8(consts.REG_CMD.Registered, offset);
        offset += consts.REG_SIZE.Command;
        packet.writeUInt16BE(LIFETIME, offset);
        offset += consts.REG_SIZE.Lifetime;

        sendPacket(socket, packet);
    }

    function respondUnregistered(socket, sequence_no, name) {
        let agentName = tools.agentString(socket.getPeerCertificate().subject.CN);

        logger.out("SEND: %s Unregistered", agentName);

        let packet = new Buffer(consts.REG_SIZE.SeqNum + consts.REG_SIZE.Command + consts.REG_SIZE.Lifetime);
        let offset = 0;

        packet.writeUInt8(sequence_no, offset);
        offset += consts.REG_SIZE.SeqNum;
        packet.writeUInt8(consts.REG_CMD.Unregistered, offset);
        offset += consts.REG_SIZE.Command;
        packet.writeUInt16BE(LIFETIME, offset);
        offset += consts.REG_SIZE.Lifetime;

        sendPacket(socket, packet);
    }

    function respondFetchResponse(socket, sequence_no, entries) {
        let agentName = tools.agentString(socket.getPeerCertificate().subject.CN);

        logger.out("SEND: %s FetchResponse", agentName);

        let packet = new Buffer(consts.REG_SIZE.SeqNum + consts.REG_SIZE.Command + consts.REG_SIZE.NumEntries + consts.REG_SIZE.Entry * entries.length);
        let offset = 0;

        packet.writeUInt8(sequence_no, offset);
        offset += consts.REG_SIZE.SeqNum;
        packet.writeUInt8(consts.REG_CMD.FetchResponse, offset);
        offset += consts.REG_SIZE.Command;
        packet.writeUInt8(entries.length, offset);
        offset += consts.REG_SIZE.NumEntries;

        entries.forEach(function iterator(entry) {
            packet.writeUInt32BE(entry.ip, offset);
            offset += consts.REG_SIZE.IP;
            packet.writeUInt16BE(entry.port, offset);
            offset += consts.REG_SIZE.Port;
            packet.writeUInt32BE(entry.data, offset);
            offset += consts.REG_SIZE.Agent;
        });

        sendPacket(socket, packet);
    }

    function respondKeyResponse(socket, sequence_no, key) {
        let agentName = tools.agentString(socket.getPeerCertificate().subject.CN);

        logger.out("SEND: %s KeyResponse", agentName);

        let packet = new Buffer(consts.REG_SIZE.SeqNum + consts.REG_SIZE.Command + consts.REG_SIZE.KeyLength + key.length);
        let offset = {};

        tools.bufferWrite(packet, offset, sequence_no, consts.REG_SIZE.SeqNum);
        tools.bufferWrite(packet, offset, consts.REG_CMD.KeyResponse, consts.REG_SIZE.Command)
        tools.bufferWrite(packet, offset, key.length, consts.REG_SIZE.KeyLength);
        tools.bufferWrite(packet, offset, key);

        sendPacket(socket, packet);
    }

    function respondRegError(socket, sequence_no) {
        let agentName = tools.agentString(socket.getPeerCertificate().subject.CN);

        logger.out("SEND: %s Error", agentName);

        let packet = new Buffer(consts.REG_SIZE.SeqNum + consts.REG_SIZE.Command);
        let offset = {};

        tools.bufferWrite(packet, offset, sequence_no, consts.REG_SIZE.SeqNum);
        tools.bufferWrite(packet, offset, consts.REG_CMD.Error, consts.REG_SIZE.Command)

        sendPacket(socket, packet);
    }

    function sendPacket(socket, message) {
        let packet = new Buffer(consts.REG_SIZE.MagicNo + message.length);
        packet.writeUInt32BE(consts.MAGIC_NO, 0);
        for (let i = 0; i < message.length; ++i)
            packet.writeUInt8(message[i], i + consts.REG_SIZE.MagicNo);

        socket.write(packet);
    }

    function timer(agentName) {
        return setTimeout(function() {
            handleTimeout(agentName);
        }, (LIFETIME << 10) >>> 0);
    }

    function handleTimeout(agentName) {
        delete TIMERS[agentName];

        var registration = REGISTRATIONS[agentName];
        delete REGISTRATIONS[agentName];

        if (registration)
            logger.out('INFO: %s Registration Timeout', registration.agentName);
    }

    process.stdin.on('end', function() {
        process.exit(0);
    }).on('data', function(data) {
        if (data.toString() === '\n') {
            logger.out('REGISTRATIONS:\n%s', tools.objectString(REGISTRATIONS));
            logger.out('CERTIFICATIONS:\n%s', tools.objectString(CERTIFICATIONS));
            logger.out('AGENTS:\n%s', tools.objectString(AGENTS));
            let util = require('util');

            logger.out('VALID:\n%s', tools.objectString([...VALID]));
        }
    });

    if (module === require.main)
        process.nextTick(generateRootCA);
})();

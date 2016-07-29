;(function() {
    "use strict";

    Object.freeze(module.exports = Object.create(exports));

    require('./cake.js');

    const crypto = require('crypto');

    const LOCAL = /^-l$/.test(process.argv[process.argv.length - 1]);
    const DEBUG = /^-d$/.test(process.argv[process.argv.length - 1]);

    const CIRCUIT_LENGTH = 3;
    const LOCAL_IP = tools.localIPv4();
    const DIGEST = crypto.randomBytes(4).readUInt32LE(0);
    const MAGIC_NO = 0xCA4BE001;

    const TIMEOUT_INTERVAL = 3000;
    const MAX_TIMEOUTS = 10;

    const PORTS = Object.freeze({
        CertServer:  1024,
        RegServer:   1025,
        HttpServer:  1026,
        HttpsServer: 1027
    });

    const CELL_CMD = Object.freeze({
        Create:       0x1,
        Created:      0x2,
        CreateFailed: 0x3,
        Destroy:      0x4,
        Relay:        0x5
    });

    const RELAY_CMD = Object.freeze({
        Extend:       0x1,
        Extended:     0x2,
        ExtendFailed: 0x3,
        Begin:        0x4,
        Connected:    0x5,
        BeginFailed:  0x6,
        Data:         0x7,
        End:          0x8
    });

    const CELL_SIZE = (function() {
        let self = {
            Layer:       256,
            Cell:        256 - 42,
            MagicNo:       Math.floor((MAGIC_NO.toString(16).length + 1) / 2),
            CircuitId:     4,
            CellType:      1,
            AgentId:       4,
            StreamId:      2,
            Digest:        4,
            BodyLength:    2,
            RelayCmd:      1
        };
        self.RelayHeader = self.MagicNo + self.CircuitId + self.CellType + self.StreamId + self.Digest + self.BodyLength + self.RelayCmd;
        self.RelayBody = self.Cell - self.RelayHeader;
        return Object.freeze(self);
    })();

    const REG_CMD = Object.freeze({
        Register:      0x1,
        Registered:    0x2,
        FetchRequest:  0x3,
        FetchResponse: 0x4,
        KeyRequest:    0x5,
        KeyResponse:   0x6,
        Unregister:    0x7,
        Unregistered:  0x8,
        Error:         0x9
    });

    const REG_SIZE = (function() {
        let self = {
            MagicNo:    Math.floor((MAGIC_NO.toString(16).length + 1) / 2),
            SeqNum:     1,
            Command:    1,
            IP:         4,
            Port:       2,
            Agent:      4,
            KeyLength:  2,
            Lifetime:   2,
            NumEntries: 1
        };
        self.Entry = self.IP + self.Port + self.Agent;
        return Object.freeze(self);
    })();

    const CERT_CMD = Object.freeze({
        Get:     1,
        Request: 2,
        Root:    3,
        Signed:  4,
        Error:   5
    });

    const CERT_SIZE = Object.freeze({
        Packet:    4096,
        Command:      1,
        SeqNum:       1,
        AgentId:      CELL_SIZE.AgentId,
        HasConfig:    1,
        Length:       2
    });

    exports.CELL_CMD = CELL_CMD;
    exports.RELAY_CMD = RELAY_CMD;
    exports.CELL_SIZE = CELL_SIZE;
    exports.DIGEST = DIGEST;
    exports.MAGIC_NO = MAGIC_NO;
    exports.REG_CMD = REG_CMD;
    exports.REG_SIZE = REG_SIZE;
    exports.CIRCUIT_LENGTH = CIRCUIT_LENGTH;
    exports.LOCAL_IP = LOCAL_IP;
    exports.CERT_SIZE = CERT_SIZE;
    exports.CERT_CMD = CERT_CMD;
    exports.PORTS = PORTS;
    exports.TIMEOUT_INTERVAL = TIMEOUT_INTERVAL;
    exports.MAX_TIMEOUTS = MAX_TIMEOUTS;
    exports.LOCAL = LOCAL;
    exports.DEBUG = DEBUG;

    // exports.INSTANCE = INSTANCE;

    // const INSTANCE = Object.seal({
    //     proxyPort: undefined,
    //     agentId: undefined
    // });
})();

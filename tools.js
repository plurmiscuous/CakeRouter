;(function() {
    "use strict";

    Object.freeze(module.exports = Object.create(exports));

    require('./cake.js');

    exports.localIPv4 = localIPv4;
    exports.convertIPv4toUInt32 = convertIPv4toUInt32;
    exports.convertUInt32toIPv4 = convertUInt32toIPv4;
    exports.padToLength = padToLength;
    exports.agentString = agentString;
    exports.objectString = objectString;
    exports.bufferRead = bufferRead;
    exports.bufferSlice = bufferSlice;
    exports.bufferWrite = bufferWrite;
    exports.bufferXor = bufferXor;

    const os = require('os');

    // This is repeat from consts.js to prevent a circular dependency problem
    const LOCAL = /^-l$/.test(process.argv[process.argv.length - 1]);

    // returns the local ip address
    function localIPv4() {
        if (LOCAL)
            return '127.0.0.1';
        let interfaces = os.networkInterfaces();
        for (let i in interfaces)
            for (let j in interfaces[i]) {
                let address = interfaces[i][j];
                if (address.family === 'IPv4' && !address.internal)
                    return address.address;
            }
        return undefined;
    }

    // converts a 'aaa.bbb.ccc.ddd' string into an unsigned
    // int 0xAABBCCDD where 0xAA == aaa, 0xBB == bbb, etc.
    function convertIPv4toUInt32(ip) {
        if (ip === 'localhost')
            ip = '127.0.0.1';
        let bytes = ip.split('.');
        // console.assert(bytes.length === 4);
        let uint = 0;
        bytes.forEach(function iterator(byte) {
            uint = uint * 256 + (+byte);
        });
        return uint >>> 0;
    }

    // converts an unsigned int 0xAABBCCDD into a 'aaa.bbb.ccc.ddd'
    // string where 0xAA == aaa, 0xBB == bbb, etc.
    function convertUInt32toIPv4(uint) {
        uint = Number(uint);
        // console.assert(uint >= 0);
        let ip = '';
        for (let i = 0; i < 4; ++i) {
            ip = (uint % 256) + ip;
            if (i != 3)
                ip = '.' + ip;
            uint = Math.floor(uint >>> 8);
        }
        // console.assert(uint === 0);
        return ip;
    }

    // convert a number or string to a 4-character string, prefixed with zeros
    // if necessary
    function padToLength(number, length, right) {
        if (typeof number === 'undefined')
            return pad;
        let pad = new Array(length).join('0');
        if (right)
            return (number + pad).substring(0, length);
        else
            return (pad + number).slice(-length);
    }

    // returns a hex string representation of the agentId
    function agentString(agentId) {
        return padToLength(agentId.toString(16).toUpperCase(), 8);
    }

    function objectString(object) {
        return JSON.stringify(object, null, 4);
    }

    function bufferRead(buffer, offset, length) {
        offset.position = offset.position || 0;

        let val = length && length > 0 && length <= 6 ?
                buffer.readUIntBE(offset.position, length) : new Buffer(0);
        offset.position += length;

        return val;
    }

    function bufferSlice(buffer, offset, length) {
        offset.position = offset.position || 0;

        length = length || (buffer.length - offset.position);
        let val = buffer.slice(offset.position, offset.position + length);
        offset.position += length;

        return val;
    }

    function bufferWrite(buffer, offset, value, length) {
        offset.position = offset.position || 0;

        let fn = length && length > 0 && length <= 6 ?
                buffer.writeUIntBE : buffer.write;
        length = length || Buffer.byteLength(value);

        fn.call(buffer, value, offset.position, length);
        offset.position += length;
    }

    function bufferXor(buffer1, buffer2, length) {
        if (!length)
            length = buffer1.length < buffer2.length ? buffer2.length : buffer1.length;

        let buffer = new Buffer(length).fill(0);

        if (buffer1.length < length || buffer2.length < length) {
            let short = buffer1.length < buffer2.length ? buffer1 : buffer2;
            let other = short == buffer1 ? buffer2 : buffer1;
            length = other.length < length ? other.length : length;
            for (let i = 0; i < short.length; ++i)
                buffer[i] = short[i] ^ other[i];
            for (let i = short.length; i < length; ++i)
                buffer[i] = other[i];
        } else
            for (let i = 0; i < length; ++i)
                buffer[i] = buffer1[i] ^ buffer2[i];
        return buffer;
    }
})();

;(function() {
    "use strict";

    Object.freeze(module.exports = Object.create(exports));

    require('./cake.js');

    const SECRET = new Buffer('0132531f77e1994c54637b7defb1199773881661408a9e48e6a8753f4dffd7494dc68f175e127010122b25b498edbb2dd2f8aa9b15525e52fa873edae0a5cfb8d928');
    const cipherAlgorithm = 'aes-256-gcm';

    const PASSWORD = SECRET.slice(0, 32);
    const IV = SECRET.slice(32, 44);
    const AUTH = SECRET.slice(44);

    exports.init = init;
    exports.addPublicKey = addPublicKey
    exports.encrypt = encrypt;
    exports.decrypt = decrypt;
    exports.print = print;

    const crypto = require('crypto');
    const constants = require('constants');

    const KEYS = {};

    const SELF = {};

    function init(privateKey) {
        SELF.privateKey = privateKey;
    }

    function addPublicKey(agent, publicKey) {
        agent = tools.agentString(agent);

        if (!KEYS.hasOwnProperty(agent))
            KEYS[agent] = {};

        KEYS[agent].publicKey = publicKey;
    }

    function encrypt(plainText, callback) {
        return callback(null, plainText);
        var cipher = crypto.createCipheriv(cipherAlgorithm, PASSWORD, IV);
        cipher.setAAD(AUTH);
        var cipherText = cipher.update(plainText, 'hex', 'hex');
        cipherText += cipher.final('hex');
        var tag = cipher.getAuthTag();

        cipherText = new Buffer(cipherText, 'hex');

        return callback(null, Buffer.concat([cipherText, tag]));


        // if (!KEYS.hasOwnProperty(agent) || !KEYS[agent].hasOwnProperty('publicKey'))
        //     return callback(new Error('No public key for ' + agent));

        // try {
        //     var encryptOptions = {
        //         key: KEYS[agent].publicKey,
        //         // padding: constants.RSA_NO_PADDING
        //     };
        //     var cipherText = crypto.publicEncrypt(encryptOptions, plainText);

        //     return callback(null, cipherText);
        // } catch (err) {
        //     return callback(err);
        // }
    }

    function decrypt(data, callback) {
        return callback(null, data);
        let cipherText = data.slice(0, -16);
        let tag = data.slice(-16);

        var decipher = crypto.createDecipheriv(cipherAlgorithm, PASSWORD, IV);
        decipher.setAAD(AUTH);
        decipher.setAuthTag(tag);
        var recoveredText = decipher.update(cipherText, 'hex', 'hex');
        recoveredText += decipher.final('hex');

        return callback(null, new Buffer(recoveredText, 'hex'));

        // if (!SELF.hasOwnProperty('privateKey'))
        //     return callback(new Error('No private key'));

        // try {
        //     var decryptOptions = {
        //         key: SELF.privateKey,
        //         // padding: constants.RSA_NO_PADDING
        //     };
        //     var recoveredText = crypto.privateDecrypt(decryptOptions, cipherText);

        //     return callback(null, recoveredText);
        // } catch (err) {
        //     return callback(err);
        // }
    }

    function print() {
        let keys = {};

        Object.getOwnPropertyNames(KEYS).forEach(function(name) {
            keys[name] = '[ ' + Object.getOwnPropertyNames(KEYS[name]).toString().split(',').join(', ') + ' ]';
        });

        logger.out("KEYS:\n%s", tools.objectString(keys));
    }
})();

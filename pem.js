;(function() {
    "use strict";

    Object.freeze(module.exports = Object.create(exports));

    // require('./cake.js');

    const spawn = require('child_process').spawn;
    const path = require('path');
    const fs = require('fs');
    const net = require('net');
    const crypto = require('crypto');

    const TMPDIR = (function tmpdir() {
        var path = process.env.TMPDIR || process.env.TEMP || '/tmp';
        if (/.\/$/.test(path))
            path = path.slice(0, -1);
        return path;
    })();
    const TMPFILE = ':TMPFILE:';  // colons cannot be in filenames (Mac/Win/Linux)

    const KEY_SIZE = 2048;
    const HASH_ALG = 'sha256';

    exports.private = getPrivate;
    exports.csr = getCsr;
    exports.certificate = getCertificate;
    exports.public = getPublic;
    exports.fingerprint = getFingerprint;
    exports.verify = verifySigning;

    exports.getCertificateInfo = getCertificateInfo;

    const key_strs = Object.freeze({
        pub: 'PUBLIC KEY',
        rsa: 'RSA PRIVATE KEY',
        crt: 'CERTIFICATE',
        csr: 'CERTIFICATE REQUEST'
    });

    function getPrivate(callback) {
        let params = [
            'genrsa',
            '-rand',
            '/dev/random',
            KEY_SIZE
        ];

        execOpenSSL(params, key_strs.rsa, null, function(error, key) {
            return callback(error, error ? null : key);
        });
    }

    function getCsr(options, callback) {
        options = options || {};

        if (!options.key)
            return callback(new Error('no key provided'));

        if (options.CN && net.isIP(options.CN)) {
            if (!options.SAN)
                options.SAN = [options.CN];
            else if (!Array.isArray(options.SAN))
                options.SAN = [options.SAN, options.CN];
            else if(options.SAN.indexOf(options.CN) === -1)
                options.SAN = options.SAN.concat([options.CN]);
        } else if (options.SAN && !Array.isArray(options.SAN))
            options.SAN = [options.SAN];
        else if (!options.SAN)
            options.SAN = [consts.LOCAL_IP];

        let params = [
            'req',
            '-new',
            '-' + HASH_ALG,
            '-subj',
            subject(options),
            '-key',
            TMPFILE
        ];
        let tmpfiles = [options.key];

        let config = null;
        if (options.SAN) {
            params.push('-extensions');
            params.push('v3_req');
            params.push('-config');
            params.push(TMPFILE);
            let names = options.SAN.map(function(name, idx) {
                return (net.isIP(name) ? 'IP' : 'DNS') + '.' + (idx + 1) + ' = ' + name;
            });

            tmpfiles.push(config = [
                '[req]',
                'req_extensions = v3_req',
                'distinguished_name = req_distinguished_name',
                '[v3_req]',
                'subjectAltName = @alt_names',
                '[alt_names]',
                names.join('\n'),
                '[req_distinguished_name]',
                'commonName = Common Name',
                'commonName_max = 64',
            ].join('\n'));
        }

        execOpenSSL(params, key_strs.csr, tmpfiles, function(error, data) {
            return callback(error, error ? null : {
                csr:    data,
                key:    options.key,
                config: config
            });
        });
    }

    function getCertificate(options, callback) {
        options = options || {};
        options.days = Number(options.days) || 365;

        if (!options.csr)
            return callback(new Error('no request provided'));

        if (!options.key)
            return callback(new Error('no key provided'));

        let params = [
            'x509',
            '-req',
            '-' + HASH_ALG,
            '-days',
            options.days,
            '-in',
            TMPFILE
        ];
        let tmpfiles = [options.csr];

        if (options.certificate) {
            params.push('-CA');
            params.push(TMPFILE);
            tmpfiles.push(options.certificate);
            params.push('-CAkey');
            params.push(TMPFILE);
            tmpfiles.push(options.key);
            if (options.serial) {
                params.push('-set_serial');
                params.push('0x' + (options.serial.toString(16)).slice(-16));
            } else
                params.push('-CAcreateserial');
        } else {
            params.push('-signkey');
            params.push(TMPFILE);
            tmpfiles.push(options.key);
        }

        if (options.config) {
            params.push('-extensions');
            params.push('v3_req');
            params.push('-extfile');
            params.push(TMPFILE);
            tmpfiles.push(options.config);
        }

        execOpenSSL(params, key_strs.crt, tmpfiles, function(error, data) {
            if (error)
                return callback(error);

            let response = {
                key:         options.key,
                csr:         options.csr,
                certificate: data
            };
            return callback(null, response);
        });
    }

    /**
     * Exports a public key from a private key, CSR or certificate
     *
     * @param {String} source PEM encoded private key, CSR or certificate
     * @param {Function} callback Callback function with an error object and {publicKey}
     */
    function getPublic(source, callback) {
        let params;
        if (source.match(/BEGIN(\sNEW)? CERTIFICATE REQUEST/))
            params = [
                'req',
                '-in',
                TMPFILE,
                '-pubkey',
                '-noout'
            ];
        else if (source.match(/BEGIN RSA PRIVATE KEY/))
            params = [
                'rsa',
                '-in',
                TMPFILE,
                '-pubout'
            ];
        else
            params = [
                'x509',
                '-in',
                TMPFILE,
                '-pubkey',
                '-noout'
            ];

        execOpenSSL(params, key_strs.pub, source, function(error, key) {
            return callback(error, error ? null : key);
        });
    }

    function getFingerprint(certificate, callback) {
        let params = [
            'x509',
            '-in',
            TMPFILE,
            '-fingerprint',
            '-noout',
            '-sha1'
        ];


        spawnWrapper(params, certificate, false, function(err, code, stdout) {
            if (err)
                return callback(err);

            let match = stdout.match(/Fingerprint=([0-9A-F:]+)$/mi);
            if (match)
                return callback(null, {
                    fingerprint: match[1]
                });

            return callback(new Error('No fingerprint'));
        });
    }

    function verifySigning(certificate, ca, callback) {
        let files = [
            ca,
            certificate
        ];

        let params = [
            'verify',
            '-CAfile',
            TMPFILE,
            TMPFILE
        ];

        spawnWrapper(params, files, function(err, code, stdout) {
            if (err)
                return callback(err);

            callback(null, stdout.trim().slice(-4) === ': OK');
        });
    }

    function subject(options) {
        options = options || {};

        let info = {
            C:  'NA',
            L:  'Internet',
            O:  'CakeRouting',
            OU: 'Cake Unit',
            CN: options.CN || 'Cake Agent',
            EA: 'user@internet.tld',
        };

        let csr = [];
        Object.getOwnPropertyNames(info).forEach(function iterator(key) {
            if (info[key])
                csr.push('/' + key + '=' + info[key].replace(/[^\w \.\*\-@]+/g, ' ').trim());
        });

        return csr.join('');
    }

    /**
     * Generically spawn openSSL, without processing the result
     *
     * @param {Array}        params   The parameters to pass to openssl
     * @param {Function}     callback Called with (error, exitCode, stdout, stderr)
     */
    function spawnOpenSSL(params, callback) {
        let pathBin = 'openssl';

        let openssl = spawn(pathBin, params);

        let stdout = '';
        openssl.stdout.on('data', function(data) {
            stdout += (data || '').toString('binary');
        });

        let stderr = '';
        openssl.stderr.on('data', function(data) {
            stderr += (data || '').toString('binary');
        });

        // We need both the return code and access to all of stdout.  Stdout isn't
        // *really* available until the close event fires; the timing nuance was
        // making this fail periodically.
        let needed = 2;  // wait for both exit and close.
        let code = -1;
        let finished = false;
        let done = function(err) {
            if (finished)
                return;

            if (err) {
                finished = true;
                return callback(err);
            }

            if (--needed < 1) {
                finished = true;
                if (code)
                    callback(new Error('Invalid openssl exit code: ' + code + '\n% openssl ' + params.join(' ') + '\n' + stderr), code);
                else
                    callback(null, code, stdout, stderr);
            }
        };

        openssl.on('close', function() {
            stdout = new Buffer(stdout, 'binary').toString('utf-8');
            stderr = new Buffer(stderr, 'binary').toString('utf-8');
            done();
        }).on('exit', function(ret) {
            code = ret;
            done();
        }).on('error', done);
    }

    function spawnWrapper(params, tmpfiles, callback) {
        let files = [];

        if (tmpfiles) {
            tmpfiles = [].concat(tmpfiles);
            params.forEach(function iterator(param, idx) {
                if (param === TMPFILE) {
                    let filepath = path.join(TMPDIR, crypto.randomBytes(24).toString('hex'));
                    params[idx] = filepath;
                    files.push({
                        path: filepath,
                        contents: tmpfiles.shift()
                    });
                }
            });
        }

        let unlink = files.map(function(file) {
            fs.writeFileSync(file.path, file.contents);
            return file.path;
        });

        spawnOpenSSL(params, function(err, code, stdout, stderr) {
            unlink.forEach(function iterator(filepath) {
                fs.unlink(filepath);
            });
            callback(err, code, stdout, stderr);
        });
    }

    /**
     * Spawn an openssl command
     */
    function execOpenSSL(params, searchStr, tmpfiles, callback) {
        spawnWrapper(params, tmpfiles, function(err, code, stdout, stderr) {
            if (err)
                return callback(err);

            let start, end;
            if ((start = stdout.match(new RegExp('\\-+BEGIN ' + searchStr + '\\-+$', 'm'))))
                start = start.index;
            else
                start = -1;

            if ((end = stdout.match(new RegExp('^\\-+END ' + searchStr + '\\-+', 'm'))))
                end = end.index + (end[0] || '').length;
            else
                end = -1;

            if (start >= 0 && end >= 0)
                return callback(null, stdout.substring(start, end));
            else {
                err = searchStr + ' not found from openssl output:\n---stdout---\n' + stdout + '\n---stderr---\n' + stderr + '\nexit code: ' + code;
                return callback(new Error(err));
            }
        });
    }

    /**
     * Reads subject data from a certificate or a CSR
     *
     * @param {String} certificate PEM encoded CSR or certificate
     * @param {Function} callback Callback function with an error object and {country, state, locality, organization, organizationUnit, commonName, emailAddress}
     */
    function getCertificateInfo(certificate, callback) {
        certificate = certificate.toString();

        var type = certificate.match(/BEGIN(\sNEW)? CERTIFICATE REQUEST/) ? 'req' : 'x509',
            params = [type,
                '-noout',
                '-text',
                '-in',
                TMPFILE
            ];
        spawnWrapper(params, certificate, function(err, code, stdout) {
            if (err) {
                return callback(err);
            }
            return fetchCertificateData(stdout, callback);
        });
    }

    function fetchCertificateData(certificate, callback) {
        certificate = (certificate || '').toString();
        var serial, subject, subject2, extra, tmp, issuer, issuer2, certValues = {issuer:{}};
        var validity = {};
        var san;

        if ((serial = certificate.match(/Serial Number:\s*([^\n]*)\n/)) && serial.length > 1) {
            certValues.serial = serial[1];
        }

        if ((subject = certificate.match(/Subject:([^\n]*)\n/)) && subject.length > 1) {
            subject2 = linebrakes(subject[1] + '\n');
            subject = subject[1];
            extra = subject.split('/');
            subject = extra.shift() + '\n';
            extra = extra.join('/') + '\n';

            // country
            tmp = subject2.match(/\sC=([^\n].*?)[\n]/);
            certValues.country = tmp && tmp[1] || '';
            // state
            tmp = subject2.match(/\sST=([^\n].*?)[\n]/);
            certValues.state = tmp && tmp[1] || '';
            // locality
            tmp = subject2.match(/\sL=([^\n].*?)[\n]/);
            certValues.locality = tmp && tmp[1] || '';
            // organization
            tmp = subject2.match(/\sO=([^\n].*?)[\n]/);
            certValues.organization = tmp && tmp[1] || '';
            // unit
            tmp = subject2.match(/\sOU=([^\n].*?)[\n]/);
            certValues.organizationUnit = tmp && tmp[1] || '';
            // common name
            tmp = subject2.match(/\sCN=([^\n].*?)[\n]/);
            certValues.commonName = tmp && tmp[1] || '';
            //email
            tmp = extra.match(/emailAddress=([^\n\/].*?)[\n\/]/);
            certValues.emailAddress = tmp && tmp[1] || '';
        }

        if ((issuer = certificate.match(/Issuer:([^\n]*)\n/)) && issuer.length > 1) {
            issuer2 = linebrakes(issuer[1] + '\n');
            issuer = issuer[1];
            // country
            tmp = issuer2.match(/\sC=([^\n].*?)[\n]/);
            certValues.issuer.country = tmp && tmp[1] || '';
            // state
            tmp = issuer2.match(/\sST=([^\n].*?)[\n]/);
            certValues.issuer.state = tmp && tmp[1] || '';
            // locality
            tmp = issuer2.match(/\sL=([^\n].*?)[\n]/);
            certValues.issuer.locality = tmp && tmp[1] || '';
            // organization
            tmp = issuer2.match(/\sO=([^\n].*?)[\n]/);
            certValues.issuer.organization = tmp && tmp[1] || '';
            // unit
            tmp = issuer2.match(/\sOU=([^\n].*?)[\n]/);
            certValues.issuer.organizationUnit = tmp && tmp[1] || '';
            // common name
            tmp = issuer2.match(/\sCN=([^\n].*?)[\n]/);
            certValues.issuer.commonName = tmp && tmp[1] || '';
        }

        if ((san = certificate.match(/X509v3 Subject Alternative Name: \n([^\n]*)\n/)) && san.length > 1) {
            san = san[1].trim() + '\n';
            certValues.san = {};
            // country
            tmp = preg_match_all('DNS:([^,\\n].*?)[,\\n]', san);
            certValues.san.dns = tmp || '';
            // country
            tmp = preg_match_all('IP Address:([^,\\n].*?)[,\\n\\s]', san);
            certValues.san.ip = tmp || '';
        }

        if ((tmp = certificate.match(/Not Before\s?:\s?([^\n]*)\n/)) && tmp.length > 1) {
            validity.start = Date.parse(tmp && tmp[1] || '');
        }

        if ((tmp = certificate.match(/Not After\s?:\s?([^\n]*)\n/)) && tmp.length > 1) {
            validity.end = Date.parse(tmp && tmp[1] || '');
        }

        if (validity.start && validity.end) {
            certValues.validity = validity;
        }
        callback(null, certValues);
    }

    function linebrakes(content) {
        var helper_x, subject, type;
        helper_x = content.replace(/(C|L|O|OU|ST|CN)=/g, '\n$1=');
        helper_x = preg_match_all('((C|L|O|OU|ST|CN)=[^\n].*)', helper_x);
        for (var p=0; p<helper_x.length; p++) {
            subject = helper_x[p].trim();
            type = subject.split('=');
            if(type[1].substring(0, 4) !== 'http'){
                content = subject.split('/');
            }else{
                content = [];
                content.push(subject);
            }
            subject = content.shift();
            helper_x[p] = rtrim(subject, ',');
        }
        return ' ' + helper_x.join('\n') + '\n';
    }

    function rtrim(str, charlist) {
        charlist = !charlist ? ' \\s\u00A0' : (charlist + '')
            .replace(/([\[\]\(\)\.\?\/\*\{\}\+\$\^\:])/g, '\\$1');
        var re = new RegExp('[' + charlist + ']+$', 'g');
        return (str + '')
            .replace(re, '');
    }

    function preg_match_all(regex, haystack) {
        var globalRegex = new RegExp(regex, 'g');
        var globalMatch = haystack.match(globalRegex) || [];
        var matchArray = [],
            nonGlobalRegex, nonGlobalMatch;
        for (var i=0; i<globalMatch.length; i++) {
            nonGlobalRegex = new RegExp(regex);
            nonGlobalMatch = globalMatch[i].match(nonGlobalRegex);
            matchArray.push(nonGlobalMatch[1]);
        }
        return matchArray;
    }
})();

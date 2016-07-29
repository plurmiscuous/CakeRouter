;(function() {
    "use strict";

    Object.freeze(module.exports = exports = undefined);

    require('./cake.js');

    const fs = require('fs');
    const path = require('path');
    const http = require('http');
    const HttpProxyAgent = require('http-proxy-agent');

    const HOST = consts.LOCAL_IP;
    const PORT = consts.PORTS.HttpServer;
    const BASE = 'http://' + HOST + ':' + PORT + '/';

    const PROXY_PORT = 10101;
    const PROXY_SERVER = 'http://' + HOST + ':' + PROXY_PORT + '/';
    const AGENT = new HttpProxyAgent(PROXY_SERVER);

    logger.out('Simple HTTP Proxy Client:');

    let rootDirectory = path.join(__dirname, 'pages');
    directoryTree(rootDirectory, function(err, result) {
        if (err)
            throw err;
        getPages(result);
    });

    function getPages(result) {
        let endpoints = processTree(result);

        let finish = endpoints.length;
        endpoints.forEach(function(endpoint) {
            let options = {
                host: HOST,
                port: PORT,
                path: BASE + endpoint,
                method: 'GET',
                agent: AGENT
            };
            logger.out('%s %s', options.method, options.path);
            http.get(options, function(response) {
                finish--;
                logger.out('%d %s %s', response.statusCode, response.statusMessage, options.path);
            }).end();
        });

        setInterval(function() {
            if (finish === 0)
                process.nextTick(process.exit, 0);
        });
    }

    function processTree(tree) {
        let endpoints = [];
        helper(endpoints, tree, '');
        return endpoints;

        function helper(array, object, string) {
            if (Array.isArray(object))
                object.forEach(function(file) {
                    array.push(path.join(string, file));
                });
            else
                Object.getOwnPropertyNames(object).forEach(function(directory) {
                    if (directory === '.')
                        helper(array, object[directory], string);
                    else
                        helper(array, object[directory], path.join(string, directory));
                });
        }
    }

    function directoryTree(dir, callback) {
        var results = {};

        fs.readdir(dir, function(err, list) {
            if (err)
                return callback(err);

            results['.'] = [];

            var pending = list.length;
            if (!pending)
                return callback(null, results);

            list.forEach(function(item) {
                if (item.slice(0, 1) === '.') {
                    if (!--pending)
                        callback(null, results);
                    return;
                }

                let entry = path.resolve(dir, item);
                fs.stat(entry, function(err, stat) {
                    if (err)
                        return callback(err);

                    if (stat && stat.isDirectory()) {
                        directoryTree(entry, function(err, result) {
                            if (err)
                                return callback(err);

                            results[item] = result;
                            if (!--pending)
                                callback(null, results);
                        });
                    } else {
                        results['.'].push(item);
                        if (!--pending)
                            callback(null, results);
                    }
                });
            });
        });
    }

    function prompt() {
        process.stdin.on('end', function() {
            process.exit(0);
        }).on('data', function() {});
    }

    prompt();
})();

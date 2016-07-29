;(function() {
    "use strict";

    Object.freeze(module.exports = exports = undefined);

    require('./cake.js');

    const cluster = require('cluster');
    const http = require('http');
    const os = require('os');
    const path = require('path');
    const fs = require('fs');
    const util = require('util');

    const HOST = consts.LOCAL_IP;
    const PORT_HTTP = consts.PORTS.HttpServer;

    const PATH_ROOT = __dirname + '/pages';
    const PATH_BASE = 'http://' + HOST + ':' + PORT_HTTP;

    let httpServer = null;
    let workers = null;

    if (cluster.isMaster) {
        logger.out('Http Server http://%s:%d', HOST, PORT_HTTP);

        cluster.on('online', function(worker) {
            logger.out('[%d]: online', worker.id);
        });

        cluster.on('exit', function(worker, code, signal) {
            let s = '[' + worker.id + ']: exit';
            if (code || signal)
                s += ' (' + (code ? code : signal) + ')';
            logger.out(s);

            cluster.fork();
        });

        let cpus = os.cpus().length;
        while (cpus--)
            cluster.fork();

        process.once('SIGINT', function() {
            process.stdout.write('\n');
            process.exit(0);
        });
    } else if (cluster.isWorker) {
        httpServer = http.createServer(function(request, response) {
            handleHttpRequest(request, response);
        }).listen(PORT_HTTP, HOST, function() {
            logger.out('[%d]: listening', cluster.worker.id);
        });
    }

    function handleHttpRequest(request, response) {
        let file = request.url;
        if (file.contains(PATH_BASE))
            file = request.url.slice(PATH_BASE.length);
        if (/^\//.test(file))
            file = file.slice(1);

        // logger.out('%s:%d %s /%s', request.socket.remoteAddress, request.socket.remotePort, request.method, file);
        logger.out('[%d]: %s:%d %s %s', cluster.worker.id, request.socket.remoteAddress, request.socket.remotePort, request.method, file);

        let filepath = path.join(PATH_ROOT, file);
        fs.access(filepath, fs.F_OK | fs.R_OK, function(err) {
            if (err)
                return http404();

            fs.readFile(filepath, function(err, data) {
                if (err)
                    return http404();

                return http200(data);
            })
        });

        function http404() {
            response.statusCode = 404;
            response.statusMessage = 'Not Found';
            response.end('404 - Not Found');
        }

        function http200(data) {
            response.statusCode = 200;
            response.statusMessage = 'OK';
            response.end(data);
        }
    }
})();

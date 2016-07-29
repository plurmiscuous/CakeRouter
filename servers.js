;(function() {
    "use strict";

    Object.freeze(module.exports = exports = undefined);

    require('./cake.js');

    let load = function(module) {
        const PATH = __dirname + '/';
        return require(PATH + module);
    };

    function start() {
        // load('certserver');
        // load('regserver');
        load('httpserver');
    }

    if (module === require.main)
        process.nextTick(start);
})();

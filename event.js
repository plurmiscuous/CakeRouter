;(function() {
    "use strict";

    Object.freeze(module.exports = Object.create(exports));

    require('./cake.js');

    exports.on = onEvent;
    exports.once = onetimeEvent;
    exports.emit = emitEvent;

    const events = require('events');
    const emitter = new events.EventEmitter();

    const ONCE = new Set();

    function onEvent(event, handler) {
        emitter.on(event, handler);

        return this;
    };
    function onetimeEvent(event, handler) {
        emitter.once(event, handler);
        ONCE.add(event);

        return this;
    };
    function emitEvent(event, callback) {
        let listeners = emitter.listenerCount(event);
        if (listeners !== 0) {
            logger.log("%d event", event);
            if (event == 'shutdown')
                emitter.removeAllListeners('restart');
            emitter.emit(event, callback);
        }

        return this;
    };
})();

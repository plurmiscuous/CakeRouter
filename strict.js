;(function() {
    "use strict";

    Object.freeze(module.exports = exports = undefined);

    (function() {
        let module = require('module');
        module.wrapper[0] += "'use strict';";
        Object.freeze(module.wrap);
    })();
})();

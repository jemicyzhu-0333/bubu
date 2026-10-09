'use strict';

// Stable compatibility facade. New content lives in src/content as independent,
// validated packs so dialogue, scenes, actions and interactions can evolve without
// turning the Electron bridge into a monolith.
module.exports = require('./content');

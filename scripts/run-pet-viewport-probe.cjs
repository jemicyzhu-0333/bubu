'use strict';
// Electron 44 dynamically imports CLI entries; do not gate on require.main.
const { main, reportFailure } = require('./verify-pet-viewport.cjs');
main().catch(reportFailure);

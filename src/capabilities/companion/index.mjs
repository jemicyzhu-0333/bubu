'use strict';

// Browser-safe read-only presentation facade. The main process continues to
// use index.js for commands; neither renderer can import a domain writer.
import forms from './form-registry.mjs';
import formArt from './presentation/form-art.mjs';
import { EMPTY_CONCURRENT_ACTIVITY, normalizeConcurrentActivity } from './contract/activity-concurrent.mjs';

export { forms, formArt, EMPTY_CONCURRENT_ACTIVITY, normalizeConcurrentActivity };
export default Object.freeze({ forms, formArt });

'use strict';

// Browser-safe read-only presentation facade. The main process continues to
// use index.js for commands; neither renderer can import a domain writer.
import forms from './form-registry.mjs';
import formArt from './presentation/form-art.mjs';
import { motionCaps } from './presentation/motion-core/action-capabilities.mjs';
import { clamp01, hermite } from './presentation/motion-core/easing.mjs';
import { EMPTY_CONCURRENT_ACTIVITY, normalizeConcurrentActivity } from './contract/activity-concurrent.mjs';

export { forms, formArt, motionCaps, clamp01, hermite, EMPTY_CONCURRENT_ACTIVITY, normalizeConcurrentActivity };
export default Object.freeze({ forms, formArt });

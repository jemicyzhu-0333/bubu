'use strict';
const suite = (cases, dressed, replacementHoldMs) => Object.freeze({
  cases: Object.freeze(cases.map(value => Object.freeze(value))),
  dressed: Object.freeze(dressed), replacementHoldMs
});
const LIFECYCLE_SUITES = Object.freeze({
  base: suite([{id:'complete',end:11800},{id:'interrupt-hold',cut:2500,end:4700},
    {id:'interrupt-flight',cut:5500,end:7700},{id:'interrupt-catch',cut:7750,end:9950},
    {id:'reduced-midflight',calmAt:5000,resumeAt:7500,end:11800},
    {id:'pause-resume',pauseAt:4300,pauseFor:900,end:12700}], [false,true], 500),
  'full-tea': suite([{id:'interrupt-flight-full-tea',cut:5500,end:16100}], [true], 9000),
  'tea-boundaries': suite([{id:'tea-end-drag-cancel',cut:5500,forceAt:14900,force:'drag',end:15800},
    {id:'tea-end-new-wave',cut:5500,forceAt:14900,force:'wave',end:17100}], [true], 9000)
});
function resolveLifecycleSuite(name = 'base') {
  if (!Object.hasOwn(LIFECYCLE_SUITES,name)) throw new TypeError(`Unknown lifecycle suite: ${name}`);
  return LIFECYCLE_SUITES[name];
}
export { LIFECYCLE_SUITES, resolveLifecycleSuite };

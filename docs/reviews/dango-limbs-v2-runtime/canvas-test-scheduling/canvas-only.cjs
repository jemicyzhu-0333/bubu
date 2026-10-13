'use strict';
// Diagnostic reproducer: no bubu production modules or assets are loaded.
const fs = require('node:fs');
const { createCanvas } = require(process.env.USAGI_CANVAS_PACKAGE);
const size = 146 * 4;
const canvases = [createCanvas(size, size), createCanvas(size, size)];
const contexts = canvases.map(c => c.getContext('2d'));
const phases = new Set(Array.from({ length: 301 }, (_, i) => i / 300));
for (const edge of [.08, .28, .4, .64, .7, .94]) for (const delta of [-.000001, 0, .000001]) phases.add(edge + delta);
const sampleCount = phases.size + 1;
const yieldEnabled = process.env.DIAG_YIELD === '1';
function trace(label, data = {}) { console.log(JSON.stringify({label, memory:process.memoryUsage(), ...data})); }
(async () => {
 trace('start', {sampleCount,yieldEnabled});let checksum=0;
 for (let action = 0; action < 2; action++) for (let view = 0; view < 3; view++) {
  trace('view-start', {action,view});
  for (let sample = 0; sample < sampleCount; sample++) {
   if (yieldEnabled && sample % 10 === 0) await new Promise(resolve => setImmediate(resolve));
   for (const context of contexts) { context.clearRect(0,0,size,size);context.fillRect(0,0,size,size); }
   const a=contexts[0].getImageData(0,0,size,size).data;
   const b=contexts[1].getImageData(0,0,size,size).data;
   checksum+=a[3]+b[3];
  }
 }
 trace('done',{checksum,expected:2*3*sampleCount*2*255});
 if(checksum!==2*3*sampleCount*2*255)throw Error('sample loss');
})();

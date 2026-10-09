'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { compileRig } = require('../tools/rig-build/build.mjs');
const { coverageReport } = require('../tools/rig-build/coverage.mjs');
const { PET_FORMS } = require('../src/capabilities/companion/form-registry.mjs');
const { EYE_FALLBACKS, MOUTH_FALLBACKS } = require('../src/capabilities/companion/presentation/rig/face.mjs');
const { default: bundled } = require('../assets/companion/usagi/rig/usagi.rig.mjs');

test('Usagi 2.0 source, runtime rig, face states, props and moving attachment ownership stay consistent', () => {
  const source = fs.readFileSync(path.join(__dirname, '../assets/companion/usagi/rig/usagi.rig.svg'), 'utf8');
  const result = compileRig(source);
  assert.equal(result.ok, true, result.errors.join('\n'));
  assert.deepEqual(result.warnings, []);
  assert.deepEqual(result.doc, bundled, 'editing SVG requires recompiling the shipped rig');
  assert.deepEqual(coverageReport(bundled, PET_FORMS.usagi, { bounds: result.bounds }).gaps, []);
  for (const [view, data] of Object.entries(bundled.views)) {
    for (const part of data.parts) {
      if (/ear_|hand_|leg_/.test(part.bone)) assert.notEqual(part.layer, 'body', `${view}: movable limbs cannot be cached`);
    }
    assert.equal(data.anchors['usagi.earwear'].bone, 'ear_r');
    assert.equal(data.props.cup.bone, 'hand_r');
    if (view === 'back') { assert.equal(data.face, null); continue; }
    assert.deepEqual(Object.keys(data.face.eyes), Object.keys(EYE_FALLBACKS));
    assert.deepEqual(Object.keys(data.face.mouth), Object.keys(MOUTH_FALLBACKS));
    assert.ok(data.face.eyes.neutral.pupil.length);
  }
});

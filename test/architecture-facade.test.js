'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { capabilityFacadeViolation } = require('../scripts/manifest-rules');

test('surface deep import into a capability is rejected (owner=null rule)', () => {
  assert.match(capabilityFacadeViolation('src/surfaces/pet/renderer.mjs', 'src/capabilities/companion/presentation/motion-core/action-capabilities.mjs'), /deep-imports capability companion/);
  assert.match(capabilityFacadeViolation('src/renderer/x.mjs', 'src/capabilities/work/domain/y.js'), /deep-imports/);
});
test('facade and contract imports from outside are allowed; capability-internal edges are left to the owner rule', () => {
  assert.equal(capabilityFacadeViolation('src/surfaces/pet/renderer.mjs', 'src/capabilities/companion/index.mjs'), null);
  assert.equal(capabilityFacadeViolation('src/surfaces/pet/renderer.mjs', 'src/capabilities/companion/index.js'), null);
  assert.equal(capabilityFacadeViolation('src/application/a.js', 'src/capabilities/work/contract/task-limits.mjs'), null);
  assert.equal(capabilityFacadeViolation('src/capabilities/work/a.js', 'src/capabilities/companion/presentation/x.mjs'), null);
});

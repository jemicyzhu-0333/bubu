'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { createPetDragSession } = require('../src/platform/electron/pet-drag-session');

test('stationary Windows pointer cannot drift even when renderer screen coordinates change on every move', () => {
  let cursor = { x: -1200, y: 400 };
  const drag = createPetDragSession({ cursorPoint: () => cursor });
  drag.begin({ x: -1300, y: 300, width: 220, height: 220 });
  for (let i = 0; i < 100; i++) {
    assert.deepEqual(drag.target({ x: -1300 + i * 10, y: 300 + i * 5 }), { x: -1300, y: 300 });
  }
  cursor = { x: 300, y: 100 }; // cross negative-origin secondary -> primary in DIP
  assert.deepEqual(drag.target({ x: 450, y: 150 }), { x: 200, y: 0 });
  drag.end();
  assert.deepEqual(drag.target({ x: 12, y: null }), { x: 12, y: null });
  drag.begin({ x: 50, y: 70 });
  cursor = { x: 310, y: 125 };
  assert.deepEqual(drag.target({}), { x: 60, y: 95 }, 'a new drag does not reuse the old origin');
});

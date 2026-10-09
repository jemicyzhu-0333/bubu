'use strict';

// 离屏 sprite 缓存的行为契约。它是“身体每帧只绘制一次”的前提：
// 缓存失效或反复重建，就等于回到每帧 484 次 fillRect 的老路。

const test = require('node:test');
const assert = require('node:assert/strict');

const { createPetSpriteCache } = require('../src/core/pet-sprite.mjs');

function recordingFactory() {
  const created = [];
  return {
    created,
    createSurface(width, height) {
      const surface = { width, height, id: created.length };
      created.push(surface);
      return surface;
    }
  };
}

test('相同 key 与尺寸只绘制一次', () => {
  const factory = recordingFactory();
  const cache = createPetSpriteCache({ createSurface: factory.createSurface });
  let paints = 0;
  const request = { width: 198, height: 198, paint: () => { paints++; } };

  const first = cache.acquire('pink|idle|open|none', request);
  const second = cache.acquire('pink|idle|open|none', request);

  assert.equal(paints, 1, '命中缓存时不能重画');
  assert.equal(first, second);
  assert.equal(factory.created.length, 1);
  assert.equal(cache.size, 1);
});

test('不同 key 各自持有位图', () => {
  const factory = recordingFactory();
  const cache = createPetSpriteCache({ createSurface: factory.createSurface });
  const request = { width: 198, height: 198, paint: () => {} };

  const idle = cache.acquire('pink|idle|open|none', request);
  const blinking = cache.acquire('pink|idle|blink|none', request);
  const forest = cache.acquire('forest|idle|open|none', request);

  assert.notEqual(idle, blinking);
  assert.notEqual(idle, forest);
  assert.equal(cache.size, 3);
});

test('尺寸变化必须重建：设备像素比变了就不能再按 1:1 贴图', () => {
  const factory = recordingFactory();
  const cache = createPetSpriteCache({ createSurface: factory.createSurface });
  let paints = 0;
  const paint = () => { paints++; };

  const retina = cache.acquire('pink|idle|open|none', { width: 198, height: 198, paint });
  const standard = cache.acquire('pink|idle|open|none', { width: 66, height: 66, paint });

  assert.equal(paints, 2);
  assert.notEqual(retina, standard);
  assert.equal(standard.width, 66);
  // 同一个 key 只保留最新尺寸，不会同时留两份。
  assert.equal(cache.size, 1);
});

test('按 LRU 上限淘汰，命中会刷新存活顺序', () => {
  const factory = recordingFactory();
  const cache = createPetSpriteCache({ createSurface: factory.createSurface, capacity: 2 });
  const request = { width: 8, height: 8, paint: () => {} };

  cache.acquire('a', request);
  cache.acquire('b', request);
  cache.acquire('a', request);   // a 变成最近使用
  cache.acquire('c', request);   // 淘汰 b

  assert.equal(cache.size, 2);
  assert.equal(cache.capacity, 2);

  let paints = 0;
  cache.acquire('a', { ...request, paint: () => { paints++; } });
  assert.equal(paints, 0, 'a 应该还在缓存里');
  cache.acquire('b', { ...request, paint: () => { paints++; } });
  assert.equal(paints, 1, 'b 应该已被淘汰');
});

test('clear() 丢弃全部位图，用于几何变更后强制重画', () => {
  const factory = recordingFactory();
  const cache = createPetSpriteCache({ createSurface: factory.createSurface });
  const request = { width: 8, height: 8, paint: () => {} };

  cache.acquire('a', request);
  cache.clear();
  assert.equal(cache.size, 0);

  let paints = 0;
  cache.acquire('a', { ...request, paint: () => { paints++; } });
  assert.equal(paints, 1);
});

test('拒绝非法输入而不是静默产出空白 sprite', () => {
  assert.throws(() => createPetSpriteCache({}), TypeError);
  assert.throws(() => createPetSpriteCache({ createSurface: 'nope' }), TypeError);

  const factory = recordingFactory();
  const cache = createPetSpriteCache({ createSurface: factory.createSurface });
  assert.throws(() => cache.acquire('', { width: 8, height: 8, paint: () => {} }), TypeError);
  assert.throws(() => cache.acquire('a', { width: 8, height: 8 }), TypeError);

  // capacity 至少为 1：0 会让每帧都重建位图。
  assert.equal(createPetSpriteCache({ createSurface: factory.createSurface, capacity: 0 }).capacity, 1);
});

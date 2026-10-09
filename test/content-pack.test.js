'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const petContent = require('../src/pet-content');
const { adaptLegacyPetContent, validateContentManifest, lintContentManifest } = require('../src/core/content-pack');

test('the built-in adapter produces one validated declarative cue per paired easter egg', () => {
  const manifest = adaptLegacyPetContent(petContent);
  assert.equal(manifest.packId, 'builtin-core');
  assert.equal(manifest.cues.length, petContent.EASTER_EGGS.length);
  assert.equal(validateContentManifest(manifest).ok, true);
  assert.ok(manifest.cues.every(cue => cue.variants.some(variant => variant.static)));
  assert.ok(manifest.cues.every(cue => cue.variants.every(variant => variant.durationMs >= 6_000)));
  assert.equal(manifest.cues.find(cue => cue.id === 'egg.meditate').variants.find(variant => variant.id === 'focus').message, '');
  assert.equal(manifest.cues.find(cue => cue.id === 'egg.dig-treasure').discoveryId, 'builtin-core.dig-treasure');
});

test('content lint rejects duplicate IDs and unknown animations', () => {
  const duplicate = structuredClone(adaptLegacyPetContent(petContent));
  duplicate.cues[1].id = duplicate.cues[0].id;
  assert.throws(() => lintContentManifest(duplicate), /duplicate cue id/);

  const unknown = structuredClone(adaptLegacyPetContent(petContent));
  unknown.cues[0].variants[0].animationId = 'run-arbitrary-code';
  assert.throws(() => lintContentManifest(unknown), /unknown animation/);
});

test('content lint rejects traversal, URLs, and oversized assets or manifests', () => {
  const manifest = structuredClone(adaptLegacyPetContent(petContent));
  manifest.assets = [{ id: 'bad', path: '../secret.js', byteSize: 10 }];
  assert.equal(validateContentManifest(manifest).ok, false);
  manifest.assets[0].path = 'https://example.com/a.png';
  assert.equal(validateContentManifest(manifest).ok, false);
  manifest.assets[0].path = 'assets/a.png';
  manifest.assets[0].byteSize = 2 * 1024 * 1024;
  assert.equal(validateContentManifest(manifest).ok, false);
  manifest.cues[0].variants[0].message = 'x'.repeat(300_000);
  assert.equal(validateContentManifest(manifest).ok, false);
});

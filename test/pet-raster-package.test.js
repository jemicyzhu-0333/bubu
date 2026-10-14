'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { fileURLToPath } = require('node:url');
const { FileMatcher } = require('app-builder-lib/internal');
const { DANGO_RASTER } = require('../assets/companion/dango/raster/dango.raster.mjs');
const { USAGI_WARDROBE } = require('../assets/companion/usagi/wardrobe/usagi.wardrobe.mjs');
const root = path.resolve(__dirname, '..');

test('packaged application keeps every referenced PNG and excludes reproducible authoring masters', () => {
  const { build } = require('../package.json');
  const accepts = new FileMatcher(root, '/unused-destination', value => value, build.files).createFilter();
  const visit = (value, manifest, files) => {
    if (!value || typeof value !== 'object') return;
    if (typeof value.src === 'string' && value.src.endsWith('.png')) files.add(fileURLToPath(new URL(value.src, manifest.baseUrl)));
    for (const child of Object.values(value)) visit(child, manifest, files);
  };
  for (const manifest of [DANGO_RASTER, USAGI_WARDROBE]) {
    const files = new Set(); visit(manifest, manifest, files);
    assert.ok(files.size > 0);
    for (const file of files) assert.equal(accepts(file, fs.statSync(file)), true, `runtime asset excluded: ${file}`);
    const sourceRoot = path.join(fileURLToPath(manifest.baseUrl), 'sources');
    const pending = [sourceRoot]; let excluded = 0;
    while (pending.length) for (const entry of fs.readdirSync(pending.pop(), { withFileTypes: true })) {
      const file = path.join(entry.parentPath, entry.name);
      if (entry.isDirectory()) pending.push(file);
      else { assert.equal(accepts(file, fs.statSync(file)), false, `authoring asset shipped: ${file}`); excluded++; }
    }
    assert.ok(excluded > 0);
  }
});

test('the opt-in run sample ships its whole body/mask group with verified content hashes', () => {
  const { DANGO_RUN } = require('../assets/companion/dango/clips/run/dango-run.mjs');
  const { createHash } = require('node:crypto');
  const { build } = require('../package.json');
  const accepts = new FileMatcher(root, '/unused-destination', value => value, build.files).createFilter();
  for (const group of DANGO_RUN.manifest.resourceGroups) for (const asset of group.assets) {
    const file = fileURLToPath(new URL(asset.src, DANGO_RUN.baseUrl));
    assert.equal(accepts(file, fs.statSync(file)), true, `run asset excluded: ${file}`);
    assert.equal(createHash('sha256').update(fs.readFileSync(file)).digest('hex'), asset.sha256);
  }
  assert.equal(accepts(path.join(root, 'assets/companion/dango/clips/run/dango-run.mjs'),
    fs.statSync(path.join(root, 'assets/companion/dango/clips/run/dango-run.mjs'))), true);
});


test('complete sip source authoring files stay out of the application while every runtime layer ships', () => {
  const { build } = require('../package.json');
  const accepts = new FileMatcher(root, '/unused-destination', value => value, build.files).createFilter();
  const sourceRoot = path.join(root, 'assets/companion/dango/raster/action-contact/sip-front-v2/sources');
  const pending = [sourceRoot]; let excluded = 0;
  while (pending.length) for (const entry of fs.readdirSync(pending.pop(), { withFileTypes: true })) {
    const file = path.join(entry.parentPath, entry.name);
    if (entry.isDirectory()) pending.push(file);
    else { assert.equal(accepts(file, fs.statSync(file)), false, `sip authoring asset shipped: ${file}`); excluded++; }
  }
  assert.ok(excluded > 0);
  const layers = Object.values(DANGO_RASTER.tools).filter(value => value.sourceContactPose?.id === 'sip-front-v2');
  assert.equal(layers.length, 4);
  for (const layer of layers) {
    assert.equal(layer.sourceContactPose.runtimeReady, false);
    const file = fileURLToPath(new URL(layer.src, DANGO_RASTER.baseUrl));
    assert.equal(accepts(file, fs.statSync(file)), true, `sip runtime layer excluded: ${file}`);
  }
});

test('preferred short sip masters stay excluded while both unchanged runtime sprites ship', () => {
  const { build } = require('../package.json');
  const accepts = new FileMatcher(root, '/unused-destination', value => value, build.files).createFilter();
  const sourceRoot = path.join(root, 'assets/companion/dango/raster/action-contact/sip-front-v1/sources');
  const pending = [sourceRoot]; let excluded = 0;
  while (pending.length) for (const entry of fs.readdirSync(pending.pop(), { withFileTypes: true })) {
    const file = path.join(entry.parentPath, entry.name);
    if (entry.isDirectory()) pending.push(file);
    else { assert.equal(accepts(file, fs.statSync(file)), false, `short sip source shipped: ${file}`); excluded++; }
  }
  assert.ok(excluded > 0);
  const layers = Object.values(DANGO_RASTER.tools).filter(value => value.sourceContactPose?.id === 'sip-front-short-v1');
  assert.equal(layers.length, 2);
  for (const layer of layers) {
    const file = fileURLToPath(new URL(layer.src, DANGO_RASTER.baseUrl));
    assert.equal(accepts(file, fs.statSync(file)), true, `short sip runtime excluded: ${file}`);
  }
});

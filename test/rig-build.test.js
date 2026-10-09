'use strict';

const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { pathToFileURL } = require('node:url');
const vm = require('node:vm');
const { execFileSync } = require('node:child_process');
const { parseSvg } = require('../tools/rig-build/svg-parse.mjs');
const { parseTransform, shapeToPath, pathBounds } = require('../tools/rig-build/svg-geometry.mjs');
const { compileRig, emitModule } = require('../tools/rig-build/build.mjs');
const { coverageReport } = require('../tools/rig-build/coverage.mjs');
const { PET_FORMS } = require('../src/capabilities/companion/form-registry.mjs');
const { createRendererModuleLoader } = require('../test-support/renderer-modules');

const ROOT = path.resolve(__dirname, '..');
const SPROUT = path.join(ROOT, 'tools/rig-build/examples/sprout.rig.svg');
const svg = body => `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 66 66" data-rig-id="t">${body}</svg>`;

test('the SVG reader copes with editor output: prolog, comments, CDATA, entities and namespaces', () => {
  const root = parseSvg(`<?xml version="1.0"?><!DOCTYPE svg><!-- a > b -->
    <svg xmlns:inkscape="x" viewBox="0 0 1 1"><style><![CDATA[.a{fill:red}]]></style>
    <g inkscape:label="bone:arm_r pivot:1,2" data-note='a > b &amp; c'><path d="M0 0L1 1"/></g></svg>`);
  const group = root.children.find(child => child.name === 'g');
  assert.equal(group.attributes['inkscape:label'], 'bone:arm_r pivot:1,2');
  assert.equal(group.attributes['data-note'], 'a > b & c');
  assert.equal(root.children[0].text, '.a{fill:red}');
  assert.throws(() => parseSvg('<svg><g></svg>'), /mismatched/);
});

test('transforms compose left to right and basic shapes become path data', () => {
  const matrix = parseTransform('translate(10 5) rotate(90) scale(2)');
  assert.deepEqual(matrix.map(v => Math.round(v * 1e6) / 1e6), [0, 2, -2, 0, 10, 5]);
  assert.equal(shapeToPath({ name: 'polygon', attributes: { points: '0,0 4,0 4,4' } }), 'M0 0L4 0L4 4Z');
  assert.match(shapeToPath({ name: 'circle', attributes: { cx: '5', cy: '5', r: '2' } }), /^M3 5A2 2/);
  assert.match(shapeToPath({ name: 'rect', attributes: { x: '0', y: '0', width: '10', height: '6', rx: '2' } }), /a2 2 0 0 1/);
  assert.equal(shapeToPath({ name: 'text', attributes: {} }), null);
  const box = pathBounds('M0 0 l10 0 v5 h-10 z', [2, 0, 0, 2, 1, 1]);
  assert.deepEqual(box, { minX: 1, minY: 1, maxX: 21, maxY: 11 });
});

test('Inkscape layer names and data attributes are equivalent markers', () => {
  const byData = compileRig(svg(`<g data-bone="arm_r" data-pivot="54,41" data-layer="front">
    <circle cx="57" cy="48" r="4" fill="#fff"/></g>`)).doc;
  const byLabel = compileRig(svg(`<g inkscape:label="bone:arm_r pivot:54,41 layer:front">
    <circle cx="57" cy="48" r="4" fill="#fff"/></g>`)).doc;
  assert.deepEqual(byLabel.views, byData.views);
  assert.deepEqual(byData.views.front.bones.arm_r, { parent: 'root', pivot: [54, 41] });
  assert.equal(byData.views.front.parts[0].layer, 'front');
});

test('a child circle marked pivot sets the bone pivot through the group transform', () => {
  const doc = compileRig(svg(`<g transform="translate(10,0)" inkscape:label="bone:ear_l layer:back">
    <circle inkscape:label="pivot" cx="20" cy="15" r="1"/><path d="M20 15 L18 0"/></g>`)).doc;
  assert.deepEqual(doc.views.front.bones.ear_l.pivot, [30, 15]);
  assert.equal(doc.views.front.parts[0].shapes.length, 1, 'the pivot marker is not drawn');
});

test('hidden face and prop states are kept; hidden plain layers and outside-view content are dropped', () => {
  const result = compileRig(svg(`<image href="ref.png"/>
    <g data-view="front">
      <g data-layer="body"><path d="M0 0H10V10Z" fill="#eee"/></g>
      <g style="display:none"><path d="M0 0H5V5Z"/></g>
      <g data-face="eyes:closed" style="display:none"><path d="M1 1H2" stroke="#000"/></g>
      <g data-face="eyes:neutral"><g data-pupil=""><circle cx="3" cy="3" r="1"/></g></g>
      <g data-face="mouth:neutral"><path d="M1 5H3" stroke="#000"/></g>
      <g data-prop="cup" visibility="hidden"><rect x="1" y="1" width="2" height="3"/></g>
    </g>
    <g inkscape:label="guides"><path d="M0 0H99"/></g>`));
  assert.equal(result.ok, true, result.errors.join('\n'));
  const front = result.doc.views.front;
  assert.equal(front.parts.flatMap(part => part.shapes).length, 1);
  assert.ok(front.face.eyes.closed && front.face.eyes.neutral.pupil.length === 1);
  assert.equal(front.props.cup.layer, 'front', 'props default to the front layer');
  assert.deepEqual(Object.keys(result.doc.views), ['front']);
});

test('gradients flatten to a stop colour and unsupported input produces warnings, not silence', () => {
  const result = compileRig(svg(`<defs><linearGradient id="g"><stop offset="0" stop-color="#111"/>
    <stop offset="1" style="stop-color:#222"/></linearGradient></defs><style>.x{}</style>
    <path d="M0 0H9V9Z" fill="url(#g)" fill-opacity="0.5"/><text>hi</text>`));
  assert.equal(result.doc.views.front.parts[0].shapes[0].fill, 'rgba(34,34,34,0.5)');
  assert.ok(result.warnings.some(w => /gradient g flattened/.test(w)));
  assert.ok(result.warnings.some(w => /<style> sheet was ignored/.test(w)));
  assert.ok(result.warnings.some(w => /<text> is not supported/.test(w)));
});

test('art scale and origin map a large drawing into the 66-unit body space', () => {
  const doc = compileRig(`<svg viewBox="0 0 660 660" data-art-scale="0.1" data-art-origin="0,0">
    <g data-bone="arm_r" data-pivot="540,410"><path d="M540 410 L570 480"/></g></svg>`).doc;
  assert.deepEqual(doc.views.front.bones.arm_r.pivot, [54, 41]);
  assert.deepEqual(doc.views.front.parts[0].shapes[0].m, [0.1, 0, 0, 0.1, 0, 0]);
});

test('the demo compiles into a valid rig whose coverage names every fallback', () => {
  const result = compileRig(fs.readFileSync(SPROUT, 'utf8'));
  assert.equal(result.ok, true, result.errors.join('\n'));
  assert.deepEqual(result.warnings, []);
  assert.deepEqual(Object.keys(result.doc.views).sort(), ['back', 'front', 'profile']);
  assert.deepEqual(result.doc.views.front.anchors['usagi.earwear'], { bone: 'ear_r', x: 44, y: -6 });
  const report = coverageReport(result.doc, PET_FORMS.usagi, { bounds: result.bounds });
  assert.match(report.text, /three-quarter uses profile/);
  assert.match(report.text, /sparkle wide/);
  assert.match(report.text, /: inside/);
  assert.deepEqual(report.gaps, ['view three-quarter']);
});

test('the emitted module loads natively and through the renderer module loader', async () => {
  const result = compileRig(fs.readFileSync(SPROUT, 'utf8'), { sourceName: 'sprout.rig.svg' });
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'rig-'));
  const file = path.join(dir, 'sprout.rig.mjs');
  fs.writeFileSync(file, emitModule(result.doc, result.source));
  const native = await import(pathToFileURL(file).href);
  assert.deepEqual(native.default, result.doc);
  const loaded = createRendererModuleLoader(vm.createContext({}))(file);
  assert.deepEqual(JSON.parse(JSON.stringify(loaded.default)), result.doc);
  fs.rmSync(dir, { recursive: true, force: true });
});

test('rig:build --clear writes the fallback placeholder only to the requested output', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'rig-'));
  const out = path.join(dir, 'placeholder.mjs');
  execFileSync(process.execPath, [path.join(ROOT, 'tools/rig-build/cli.mjs'), 'build', '--clear', '--out', out]);
  assert.match(fs.readFileSync(out, 'utf8'), /export default null;/);
  fs.rmSync(dir, { recursive: true, force: true });
});

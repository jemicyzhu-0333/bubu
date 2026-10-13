'use strict';
const { test } = require('node:test');
const assert = require('node:assert/strict');
const path = require('node:path');
const fs = require('node:fs');
const os = require('node:os');
const { spawnSync } = require('node:child_process');
const root = path.resolve(__dirname, '..');
test('workbench catalog and legal wardrobe selection use production identities', async () => {
  const { source } = await import('../tools/pet-workbench/source.mjs');
  const { selectGarment } = await import('../tools/pet-workbench/model.mjs');
  const catalog = source.wardrobe.PET_APPEARANCE_ITEMS;
  assert.equal(Object.keys(source.behaviors.PET_ACTIONS).length, 44);
  assert.equal(catalog.length, 43);
  const { previewSource } = await import('../tools/pet-workbench/source.mjs');
  assert.equal(Object.keys(source.sessions.SESSION_ACTIVITIES).length, 12);
  assert.equal(Object.keys(previewSource.sessions.SESSION_ACTIVITIES).length, 15);
  assert.equal(previewSource.sessions.SESSION_ACTIVITIES['mirror-music'], source.sessions.MIRROR_ACTIVITIES['mirror-music']);
  const clips = catalog.filter(item => item.id === 'usagi.paper-plane-clip' || item.id === 'usagi.compass-clip');
  assert.equal(clips.length, 2);
  assert.deepEqual(selectGarment([clips[0].id], clips[1], true, catalog), [clips[1].id]);
  const hat = catalog.find(item => item.id === 'usagi.moon-beret');
  assert.deepEqual(selectGarment([hat.id], clips[0], true, catalog), [hat.id, clips[0].id]);
  assert.deepEqual(selectGarment([hat.id], hat, false, catalog), []);
});
test('workbench phases and wardrobe metadata match production resolution', async () => {
  const { source } = await import('../tools/pet-workbench/source.mjs');
  const { inspectFrame } = await import('../tools/pet-workbench/model.mjs');
  const form = source.forms.resolvePetForm('usagi');
  const options = { form, skin: 'usagi', kind: 'action', item: source.behaviors.PET_ACTIONS['paper-return'], duration: 10500, view: 'auto', outfit: ['usagi.paper-plane-clip'], calm: false };
  assert.equal(inspectFrame(source, { ...options, elapsed: 10500 * .5 }).phase, '放飞 / 弧线回返');
  assert.equal(inspectFrame(source, { ...options, elapsed: 10500 * .78 }).phase, '接住');
  assert.equal(inspectFrame(source, { ...options, elapsed: 0, calm: true }).phase, '接住');
  assert.deepEqual(inspectFrame(source, { ...options, elapsed: 1 }).visibleIds, ['usagi.paper-plane-clip']);
  const dango = source.forms.resolvePetForm('pink');
  const item = source.wardrobe.PET_APPEARANCE_ITEMS.find(value => value.skin === 'forest');
  assert.ok(inspectFrame(source, { ...options, form: dango, skin: 'pink', outfit: [item.id], elapsed: 1, view: item.views[0] }).visibleIds.includes(item.id));
});
test('single HTML build closes module and artwork graph without forbidden references', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'bubu-workbench-'));
  try {
    const out = path.join(dir, 'review.html');
    const result = spawnSync(process.execPath, ['tools/pet-workbench/build.mjs', `--out=${out}`], { cwd: root, encoding: 'utf8' });
    assert.equal(result.status, 0, result.stderr);
    const html = fs.readFileSync(out, 'utf8');
    const manifest = JSON.parse(fs.readFileSync(out + '.manifest.json', 'utf8'));
    assert.equal(manifest.embeddedAssets, 419);
    assert.ok(manifest.modules >= 130);
    assert.equal(Object.keys(manifest.sourceHashes).some(name => name.includes('reference/') || name.includes('usagi-turnaround')), false);
    assert.equal(html.includes('/* WORKBENCH_BOOT */'), false);
    assert.ok(html.includes('type=\'importmap\''));
    assert.ok(html.includes('data:image/png;base64,'));
    const moduleJson = html.match(/const modules=(.*?), assets=/s)[1];
    const modules = JSON.parse(moduleJson);
    for (const [id, source] of Object.entries(modules)) {
      for (const match of source.matchAll(/(?:from\s*|import\s*)['"]https:\/\/bubu\.invalid\/([^'"]+)['"]/g)) {
        assert.ok(Object.hasOwn(modules, match[1]), `${id} → ${match[1]}`);
      }
    }
  } finally { fs.rmSync(dir, { recursive: true, force: true }); }
});

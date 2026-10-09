'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const root = path.resolve(__dirname, '..');
const json = file => JSON.parse(fs.readFileSync(path.join(root, file), 'utf8'));
test('0.0.2-dev.1 package identities, locks and versioned artifact names agree', () => {
  const app = json('package.json'), lock = json('package-lock.json');
  const site = json('website/package.json'), siteLock = json('website/package-lock.json');
  assert.equal(app.version, '0.0.2-dev.1');
  for (const version of [lock.version, lock.packages[''].version, site.version, siteLock.version, siteLock.packages[''].version]) assert.equal(version, app.version);
  assert.equal(app.name, 'bubu'); assert.equal(app.build.appId, 'com.bubu.app');
  assert.equal(app.build.nsis.deleteAppDataOnUninstall, false);
  assert.ok(app.build.artifactName.includes('${version}'));
  assert.ok(app.build.mac.artifactName.includes('${version}'));
});
test('candidate site does not invent unpublished downloads or an in-app update channel', () => {
  const html = fs.readFileSync(path.join(root, 'website/public/index.html'), 'utf8');
  assert.ok(html.includes('Candidate source: 0.0.2-dev.1.'));
  assert.equal(html.includes('/releases/download/'), false);
  assert.equal((html.match(/data-release-state="pending"/g) || []).length, 2);
  assert.ok(html.includes('In-app updates remain unavailable.'));
  assert.ok(html.includes('/releases/tag/v0.0.1-dev-r4'), 'historical release identity is preserved');
});

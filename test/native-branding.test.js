'use strict';
const test = require('node:test');
const assert = require('node:assert/strict');
const { EventEmitter } = require('node:events');
const { configureNativeBranding } = require('../src/platform/electron/native-branding');

function harness(ready = false) {
  const app = new EventEmitter();
  const about = [], menus = [];
  app.isReady = () => ready;
  app.setAboutPanelOptions = options => about.push(options);
  const quit = () => {};
  const items = [
    { role: 'appmenu', label: 'bubu', submenu: { items: [
      { role: 'about', label: 'About bubu' },
      { role: 'hide', label: 'Hide bubu', accelerator: 'Command+H' },
      { role: 'quit', label: 'Quit bubu', accelerator: 'CommandOrControl+Q', click: quit },
      { id: 'custom', label: 'Keep this item', click: quit }
    ] } },
    { role: 'filemenu', label: 'File' }, { role: 'editmenu', label: 'Edit' },
    { role: 'viewmenu', label: 'View' }, { role: 'windowmenu', label: 'Window' }
  ];
  const menu = { items };
  const Menu = { getApplicationMenu: () => menu, setApplicationMenu: value => menus.push(value) };
  return { app, about, menus, menu, Menu, quit };
}

test('macOS applies the visible name once at ready without replacing menu identities or actions', () => {
  const h = harness();
  const items = [...h.menu.items], subitems = [...items[0].submenu.items];
  configureNativeBranding({ app: h.app, platform: 'darwin', getMenu: () => h.Menu });
  assert.deepEqual(h.about, []);
  assert.deepEqual(h.menus, []);
  h.app.emit('ready'); h.app.emit('ready');
  assert.deepEqual(h.about, [{ applicationName: '小步' }]);
  assert.deepEqual(h.menus, [h.menu]);
  assert.equal(h.menu.items[0].label, '小步');
  assert.deepEqual(subitems.map(item => item.label), ['关于小步', '隐藏小步', '退出小步', 'Keep this item']);
  assert.equal(subitems[1].accelerator, 'Command+H');
  assert.equal(subitems[2].accelerator, 'CommandOrControl+Q');
  assert.equal(subitems[2].click, h.quit);
  for (let index = 0; index < items.length; index++) assert.equal(h.menu.items[index], items[index]);
  for (let index = 0; index < subitems.length; index++) assert.equal(items[0].submenu.items[index], subitems[index]);
});

for (const platform of ['win32', 'linux']) test(`${platform} sets About branding without creating or changing a native menu`, () => {
  const h = harness(true);
  configureNativeBranding({ app: h.app, platform, getMenu: () => { throw new Error('must not access menu'); } });
  assert.deepEqual(h.about, [{ applicationName: '小步' }]);
  assert.deepEqual(h.menus, []);
});

test('macOS respects absent and custom application menus', () => {
  for (const menu of [null, { items: [{ label: 'Custom menu', submenu: { items: [] } }] }]) {
    const h = harness(true);
    configureNativeBranding({ app: h.app, platform: 'darwin', getMenu: () => ({
      getApplicationMenu: () => menu,
      setApplicationMenu: () => { throw new Error('must not replace custom or absent menu'); }
    }) });
    assert.deepEqual(h.about, [{ applicationName: '小步' }]);
  }
});

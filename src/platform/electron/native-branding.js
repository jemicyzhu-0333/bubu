'use strict';

// Visible native labels are independent of the lowercase bubu runtime identity.
// Reuse the existing menu so roles, shortcuts, handlers and custom items survive.
function configureNativeBranding({ app, platform = process.platform, getMenu = () => require('electron').Menu }) {
  if (typeof app.setAboutPanelOptions !== 'function') return;
  function apply() {
    app.setAboutPanelOptions({ applicationName: '小步' });
    if (platform !== 'darwin') return;
    const Menu = getMenu();
    const menu = Menu.getApplicationMenu();
    const appMenu = menu?.items.find(item => item.role?.toLowerCase() === 'appmenu');
    if (!appMenu) return;
    appMenu.label = '小步';
    const labels = { about: '关于小步', hide: '隐藏小步', quit: '退出小步' };
    for (const item of appMenu.submenu?.items || []) {
      const label = labels[item.role?.toLowerCase()];
      if (label) item.label = label;
    }
    Menu.setApplicationMenu(menu);
  }
  if (app.isReady()) apply();
  else app.once('ready', apply);
}

module.exports = { configureNativeBranding };

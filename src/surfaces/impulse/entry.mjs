import '../shared/interface/entry.mjs';
'use strict';

import { createImpulseSurfaceClient } from './adapter/surface-client.mjs';
import { createQuickPanelFeature } from './quick-panel.mjs';
import { createQuickPanelLayout } from './panel-layout.mjs';

const client = createImpulseSurfaceClient();
const layout = createQuickPanelLayout({ window, document, client });

const feature = createQuickPanelFeature({
  window,
  document,
  client
});

feature.mount();
layout.mount();
window.addEventListener('pagehide', () => { layout.dispose(); feature.dispose(); }, { once: true });
